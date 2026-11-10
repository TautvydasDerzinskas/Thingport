// Posts each new thingport.net blog post to the subreddit the app is installed on: hourly (devvit.json's
// scheduler), and when a moderator picks "Check the Thingport blog now" from the subreddit's menu.
import type { IncomingMessage, ServerResponse } from "node:http";
import { context, createServer, getServerPort, reddit, redis, settings } from "@devvit/web/server";
import { FEED_URL, parseFeed, submission, toPost, type FeedEntry, type PostKind } from "../feed";

// The links already posted, with the id of the post each became.
const POSTED_KEY = "posted";
// One post a run, so a backlog never floods the subreddit.
const MAX_PER_RUN = 1;
// How long a run holds an entry while posting it, so the hourly run and a moderator's never both post it.
const CLAIM_MS = 10 * 60 * 1000;

async function fetchFeed(): Promise<FeedEntry[]> {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${FEED_URL} answered ${res.status}`);
  return parseFeed(await res.text());
}

/** True when the subreddit's newest posts already link it, so a post whose bookkeeping failed isn't posted again. */
async function onSubreddit(subredditName: string, link: string): Promise<boolean> {
  const recent = await reddit.getNewPosts({ subredditName, limit: 100 }).all();
  return recent.some((post) => post.url === link || (post.body ?? "").includes(link));
}

/** The token this run holds `link` by, or null when another run holds it. */
async function claim(link: string): Promise<string | null> {
  const key = `claim:${link}`;
  const token = `${Date.now()}:${Math.random()}`;
  await redis.set(key, token, { nx: true, expiration: new Date(Date.now() + CLAIM_MS) });
  return (await redis.get(key)) === token ? token : null;
}

/** Lets `link` go, unless the claim expired and another run holds it now: that one's is left alone. */
async function release(link: string, token: string): Promise<void> {
  const key = `claim:${link}`;
  const txn = await redis.watch(key);
  if ((await redis.get(key)) !== token) {
    await txn.unwatch();
    return;
  }
  // Fails, deleting nothing, if the key changed since it was watched.
  await txn.multi();
  await txn.del(key);
  await txn.exec();
}

async function postKind(): Promise<PostKind> {
  const value = await settings.get<string | string[]>("postKind");
  return (Array.isArray(value) ? value[0] : value) === "text" ? "text" : "link";
}

/** Posts what's new, and says what it did. */
async function check(): Promise<string> {
  const subredditName = context.subredditName;
  const posted = await redis.hGetAll(POSTED_KEY);
  const due = toPost(await fetchFeed(), (link) => link in posted);
  if (!due.length) return "Nothing new on the blog.";

  const kind = await postKind();
  const done: string[] = [];
  for (const entry of due) {
    if (done.length === MAX_PER_RUN) break;
    const token = await claim(entry.link);
    if (!token) continue;
    try {
      if (await onSubreddit(subredditName, entry.link)) {
        await redis.hSet(POSTED_KEY, { [entry.link]: "found" });
        continue;
      }
      const post = await reddit.submitPost({ subredditName, ...submission(entry, kind) });
      await redis.hSet(POSTED_KEY, { [entry.link]: post.id });
      console.log(`posted ${entry.link} as ${post.id}`);
      done.push(entry.title);
    } finally {
      await release(entry.link, token).catch(() => undefined);
    }
  }
  return done.length ? `Posted "${done.join('", "')}".` : "The new posts are already here.";
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  // Devvit drops a reply without a Content-Length, and the moderator sees only "Something went wrong".
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Requests are POSTed JSON; neither route needs the body.
  for await (const _chunk of req) void _chunk;
  try {
    if (req.url === "/internal/scheduler/check-blog") {
      console.log(await check());
      return send(res, 200, {});
    }
    if (req.url === "/internal/menu/check-blog") {
      return send(res, 200, { showToast: await check() });
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`check failed: ${message}`);
    if (req.url?.startsWith("/internal/menu/"))
      return send(res, 200, { showToast: `Couldn't check the blog: ${message}` });
    send(res, 500, { error: message });
  }
}

createServer((req, res) => void handle(req, res)).listen(getServerPort());
