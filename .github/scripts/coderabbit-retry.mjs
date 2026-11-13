// Asks CodeRabbit again for the reviews its rate limit refused, and for pushes it never got to. Once the repository's
// allowance is used up, CodeRabbit marks a pushed commit "Review rate limited", says when the next review is
// available, and never comes back to it. Run by coderabbit-retry.yml every five minutes and whenever a CodeRabbit
// check finishes. A run asks for what's due and stops, never waiting out the allowance: a later run asks the rest.
//
// A pull request waits when CodeRabbit's newest check on its head says "Review rate limited" (or the head has no check
// and the summary comment still carries the rate-limit notice: a push during a limit gets none). It also waits when
// CodeRabbit left its head unreviewed: no check at all a while after the push (into the default branch, the only one
// reviewed on its own), or a review that never finished, unless CodeRabbit posted a review of it anyway. Every notice
// and refusal, on any pull request, says when the allowance is back, and the latest of those holds back every ask, so
// at most one ask is refused per window. Asks go one at a time, the longest-waiting pull request first: a refusal
// starts a new wait, an accepted ask moves on to the next. Pull requests paused with `@coderabbitai pause` are left
// alone.
//
// CodeRabbit doesn't answer commands from bot accounts (github-actions[bot] was ignored), so the asks are posted with
// ASK_TOKEN, an ordinary account's token; an ask it leaves unanswered isn't repeated for that commit.
//
// Usage: node coderabbit-retry.mjs, with GH_TOKEN (reads), ASK_TOKEN (posts), GITHUB_API_URL and GITHUB_REPOSITORY
// set. Without ASK_TOKEN, or with DRY_RUN=true, it only says what it would ask and when.

import { pathToFileURL } from "node:url";

export const CODERABBIT = "coderabbitai[bot]";
export const ASK = "@coderabbitai review";
export const FULL_ASK = "@coderabbitai full review";
const RATE_LIMIT_MARKER = "rate limited by coderabbit.ai";
const SUMMARY_MARKER = "summarize by coderabbit.ai";
const REPLY_MARKER = "auto-generated reply by coderabbit";

const MINUTE = 60_000;
// After the published time, so the ask doesn't land a moment before the allowance is back.
const MARGIN_MS = 30_000;
// Refusals of `@coderabbitai review` often give no time; each further one on a pull request waits twice as long.
const UNKNOWN_WAIT_MS = 15 * MINUTE;
const LONGEST_WAIT_MS = 2 * 60 * MINUTE;
// Notices older than this can't hold anything back any more.
const NOTICE_HORIZON_MS = 3 * 60 * MINUTE;
// The asks for one commit; past this CodeRabbit is left to the next push.
export const MAX_ASKS_PER_COMMIT = 5;
const MAX_ASKS_PER_RUN = 10;
// CodeRabbit answers an ask within seconds, and a review it accepts shows up as a check within minutes.
const ANSWER_WAIT_MS = 3 * MINUTE;
const ANSWER_GRACE_MS = 10 * MINUTE;
const ACCEPTED_GRACE_MS = 30 * MINUTE;
// A push takes CodeRabbit a moment to pick up: a head without a check is only taken as skipped after this.
const NEW_HEAD_GRACE_MS = 3 * MINUTE;
// CodeRabbit starts on a push within a minute or two and finishes within minutes; past these it isn't coming.
const MISSED_HEAD_MS = 15 * MINUTE;
const STUCK_REVIEW_MS = 60 * MINUTE;

const time = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const plain = (body) =>
  (body ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[*_`]/g, "");
const issueNumber = (comment) => Number(comment.issue_url?.split("/").pop());
const byCodeRabbit = (comment) => comment.user?.login === CODERABBIT;
const isSummary = (comment) => byCodeRabbit(comment) && comment.body?.includes(SUMMARY_MARKER);
const isReply = (comment) => byCodeRabbit(comment) && comment.body?.toLowerCase().includes(REPLY_MARKER);
// The command on the first line: an ask carries the banner below it.
const ASK_LINE = /^\s*@coderabbitai\s+(full\s+)?review[ \t]*(?:\r?\n|$)/i;
const isAsk = (comment) => !byCodeRabbit(comment) && ASK_LINE.test(comment.body ?? "");
const isFullAsk = (comment) => isAsk(comment) && Boolean(ASK_LINE.exec(comment.body)[1]);
const rateLimited = (check) => /rate\s*limit/i.test(check.output?.title ?? "");
const stuck = (check, now) => check.status !== "completed" && now - time(check.started_at) >= STUCK_REVIEW_MS;

/** How long a CodeRabbit notice says to wait, in ms, or null when it names no time. */
export function waitFrom(body) {
  const text = plain(body);
  const unit = { hour: 60 * MINUTE, minute: MINUTE, second: 1000 };
  const match = text.match(
    /(?:next\s+(?:included\s+)?review\s+(?:will\s+be\s+)?available\s+in|please\s+wait)\s*:?\s*(\d+)\s*(hour|minute|second)s?(?:\s*(?:and|,)?\s*(\d+)\s*(minute|second)s?)?/i,
  );
  if (!match) return null;
  const [, amount, first, extra, second] = match;
  let ms = Number(amount) * unit[first.toLowerCase()];
  if (extra) ms += Number(extra) * unit[second.toLowerCase()];
  return Math.min(ms, LONGEST_WAIT_MS);
}

/** What CodeRabbit's reply to a review command says: refused (rate limit), accepted, or declined for another reason. */
export function replyOutcome(body) {
  const text = plain(body);
  if (/review\s+rate\s+limited|rate\s+limit\s+exceeded|review\s+limit\s+reached/i.test(text)) return "refused";
  if (/actions?\s+performed/i.test(text)) return "accepted";
  if (/action\s+not\s+completed/i.test(text)) return "declined";
  return null;
}

const declineReason = (body) =>
  plain(body)
    .replace(/action\s+not\s+completed/i, "")
    .trim()
    .split(/\n|(?<=\.)\s/)[0]
    .trim();

/** The newest CodeRabbit check run among a commit's check runs, or null. */
export function latestCheck(checkRuns) {
  const ours = checkRuns.filter((run) => run.app?.slug === "coderabbitai");
  ours.sort((a, b) => time(b.started_at) - time(a.started_at) || b.id - a.id);
  return ours[0] ?? null;
}

/**
 * The times CodeRabbit's notices say its allowance is back: the summary comment's rate-limit notice, and every
 * refusal of a review command. Each is { pr, kind, at, until }, times in ms.
 */
export function noticesFrom(comments, now) {
  const notices = [];
  const waitlessRefusals = new Map();
  const sorted = [...comments].sort((a, b) => time(a.created_at) - time(b.created_at));
  for (const comment of sorted) {
    const pr = issueNumber(comment);
    if (isSummary(comment) && comment.body.includes(RATE_LIMIT_MARKER)) {
      const at = time(comment.updated_at);
      notices.push({ pr, kind: "summary", at, until: at + (waitFrom(comment.body) ?? UNKNOWN_WAIT_MS) + MARGIN_MS });
    } else if (isReply(comment) && replyOutcome(comment.body) === "refused") {
      const at = time(comment.created_at);
      let wait = waitFrom(comment.body);
      if (wait === null) {
        const earlier = (waitlessRefusals.get(pr) ?? []).filter((t) => at - t < NOTICE_HORIZON_MS);
        wait = Math.min(UNKNOWN_WAIT_MS * 2 ** earlier.length, 4 * UNKNOWN_WAIT_MS);
        waitlessRefusals.set(pr, [...earlier, at]);
      }
      notices.push({ pr, kind: "refusal", at, until: at + wait + MARGIN_MS });
    }
  }
  return notices.filter((notice) => now - notice.at < NOTICE_HORIZON_MS);
}

/**
 * Whether a pull request is waiting for an ask. Returns { waiting: false, reason } or { waiting: true, since,
 * notBefore, why, ask }: since is when CodeRabbit refused its head, or left it unreviewed (the queue order), notBefore
 * the earliest time this pull request's own notices allow an ask, why says which for the log, and ask is the command.
 */
export function pullState({ pull, checkRuns, headDate, comments, reviews = [], now, asker }) {
  const check = latestCheck(checkRuns);
  const summary = comments.find(isSummary);
  let since;
  let why;
  if (check && check.status !== "completed") {
    if (!stuck(check, now)) return { waiting: false, reason: "CodeRabbit is reviewing it" };
    since = time(check.started_at);
    why = `the review started at ${check.started_at} never finished`;
  } else if (check && rateLimited(check)) {
    since = time(check.completed_at);
  } else if (check) {
    return { waiting: false, reason: `CodeRabbit's check says "${check.output?.title ?? check.conclusion}"` };
  } else if (summary?.body.includes(RATE_LIMIT_MARKER) && now - headDate >= NEW_HEAD_GRACE_MS) {
    since = time(summary.updated_at);
  } else if (now - headDate < MISSED_HEAD_MS) {
    return { waiting: false, reason: "no CodeRabbit check on its head yet" };
  } else if (pull.base?.ref !== pull.base?.repo?.default_branch) {
    return { waiting: false, reason: "no CodeRabbit check, and it only reviews pull requests into the default branch" };
  } else {
    since = headDate;
    why = `CodeRabbit never picked up the push of ${iso(headDate)}`;
  }
  if (why && reviews.some((review) => review.user?.login === CODERABBIT && review.commit_id === pull.head?.sha)) {
    return { waiting: false, reason: "CodeRabbit reviewed it, though its check didn't say so" };
  }

  if (/@coderabbitai\s+ignore\b/i.test(pull.body ?? "")) {
    return { waiting: false, reason: "its description has @coderabbitai ignore" };
  }
  const switches = comments.filter(
    (c) => !byCodeRabbit(c) && /^\s*@coderabbitai\s+(pause|resume)\b/i.test(c.body ?? ""),
  );
  const lastSwitch = switches.at(-1);
  if (lastSwitch && /pause/i.test(lastSwitch.body)) {
    return { waiting: false, reason: `paused by @${lastSwitch.user.login} at ${lastSwitch.created_at}` };
  }

  const ourAsks = comments.filter((c) => c.user?.login === asker && isAsk(c) && time(c.created_at) > headDate);
  if (ourAsks.length >= MAX_ASKS_PER_COMMIT) {
    return { waiting: false, reason: `asked ${ourAsks.length} times for this commit already` };
  }
  const lastAsk = comments.filter((c) => isAsk(c) && time(c.created_at) >= since).at(-1);
  if (lastAsk) {
    const askedAt = time(lastAsk.created_at);
    const reply = comments.find((c) => isReply(c) && time(c.created_at) >= askedAt);
    const outcome = reply && replyOutcome(reply.body);
    if (!reply && now - askedAt < ANSWER_GRACE_MS) {
      return { waiting: false, reason: `asked at ${lastAsk.created_at}, no answer yet` };
    }
    // Ignored rather than refused: asking again the same way would only be ignored again.
    if (!reply && lastAsk.user?.login === asker) {
      return { waiting: false, reason: `CodeRabbit didn't answer the ask at ${lastAsk.created_at}` };
    }
    if (outcome === "accepted" && now - askedAt < ACCEPTED_GRACE_MS) {
      return { waiting: false, reason: `CodeRabbit took the ask at ${reply.created_at}` };
    }
    if (outcome === "declined") {
      return { waiting: false, reason: `CodeRabbit declined: ${declineReason(reply.body)}` };
    }
  }

  // A refusal with no notice to go by (a summary not yet written) still gets the standard wait; an unreviewed head
  // waits only for the refusals of asks made since.
  const own = noticesFrom(comments, now).filter((notice) => notice.at >= since - 2 * MINUTE);
  const fallback = why ? since : since + UNKNOWN_WAIT_MS + MARGIN_MS;
  const notBefore = own.length ? Math.max(...own.map((n) => n.until)) : fallback;
  // A plain `review` after a refused `full review` is declined as "Already reviewed the last commit".
  const full = comments.some((c) => isFullAsk(c) && time(c.created_at) > headDate);
  return { waiting: true, since, notBefore, why: why ?? `refused at ${iso(since)}`, ask: full ? FULL_ASK : ASK };
}

/** The next ask: { pull } to ask now, { at } to wait until, or {} when nothing waits. */
export function nextAsk(waiting, hold, now) {
  if (!waiting.length) return {};
  const due = (entry) => Math.max(hold, entry.notBefore);
  const ready = waiting.filter((entry) => due(entry) <= now);
  if (ready.length) {
    ready.sort((a, b) => a.since - b.since || a.number - b.number);
    return { pull: ready[0] };
  }
  return { at: Math.min(...waiting.map(due)) };
}

function client({ apiUrl, repository, token }) {
  async function request(path, options = {}) {
    const res = await fetch(`${apiUrl}/repos/${repository}/${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${options.method ?? "GET"} ${path}`);
    return res.json();
  }
  async function user() {
    const res = await fetch(`${apiUrl}/user`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} reading the asking account`);
    return res.json();
  }
  async function all(path, pick = (page) => page) {
    const items = [];
    for (let page = 1; ; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = pick(await request(`${path}${separator}per_page=100&page=${page}`));
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
  return { request, all, user };
}

async function survey(github, { asker, now }) {
  const pulls = (await github.all("pulls?state=open")).filter((pull) => !pull.draft);
  const states = [];
  for (const pull of pulls) {
    const checkRuns = await github.all(`commits/${pull.head.sha}/check-runs?filter=all`, (page) => page.check_runs);
    const check = latestCheck(checkRuns);
    // Only heads CodeRabbit refused, never checked or never finished need their comments read.
    if (check && !rateLimited(check) && !stuck(check, now)) {
      states.push({ number: pull.number, waiting: false, reason: `CodeRabbit's check says "${check.output?.title}"` });
      continue;
    }
    const commit = await github.request(`commits/${pull.head.sha}`);
    const comments = await github.all(`issues/${pull.number}/comments`);
    const reviews = await github.all(`pulls/${pull.number}/reviews`);
    const headDate = time(commit.commit.committer.date);
    states.push({ number: pull.number, ...pullState({ pull, checkRuns, headDate, comments, reviews, now, asker }) });
  }
  const waiting = states.filter((state) => state.waiting);
  let hold = 0;
  if (waiting.length) {
    // A summary is edited in place and can keep an old notice after a review, so only a waiting pull request's
    // summary counts; a refusal anywhere means the allowance is spent for all of them.
    const numbers = new Set(waiting.map((state) => state.number));
    const recent = await github.all(`issues/comments?since=${iso(now - NOTICE_HORIZON_MS)}`);
    for (const notice of noticesFrom(recent, now)) {
      if (notice.kind === "refusal" || numbers.has(notice.pr)) hold = Math.max(hold, notice.until);
    }
  }
  return { states, waiting, hold };
}

async function awaitAnswer(github, number, askedAt, { clock, pause }) {
  const deadline = clock() + ANSWER_WAIT_MS;
  while (clock() < deadline) {
    await pause(10_000);
    const recent = await github.all(`issues/${number}/comments?since=${iso(askedAt)}`);
    const reply = recent.find((c) => isReply(c) && time(c.created_at) >= askedAt);
    if (reply) return { outcome: replyOutcome(reply.body) ?? "unclear", reply };
  }
  return { outcome: "none" };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The "Thingport ♥ CodeRabbit" banner under each ask, in the reader's GitHub theme. */
export function banner(repository) {
  const src = (theme) =>
    `https://raw.githubusercontent.com/${repository}/develop/.github/assets/coderabbit-banner-${theme}.png`;
  return `<picture><source media="(prefers-color-scheme: dark)" srcset="${src("dark")}"><img src="${src("light")}" alt="Thingport ♥ CodeRabbit" width="640" height="64"></picture>`;
}

/**
 * One run: asks for each pull request that's due, one at a time, and returns once the next isn't due yet. It never
 * waits for the allowance; only for CodeRabbit's answer to an ask, which comes within seconds.
 */
export async function askDue({
  github,
  poster,
  asker,
  dryRun,
  footer = "",
  clock = Date.now,
  pause = sleep,
  log = console.log,
}) {
  for (let asks = 0; asks < MAX_ASKS_PER_RUN;) {
    const now = clock();
    const { states, waiting, hold } = await survey(github, { asker, now });
    for (const state of states) {
      const ready = state.waiting && iso(Math.max(hold, state.notBefore));
      const when = state.waiting ? `${state.why}, to be asked from ${ready}` : state.reason;
      log(`#${state.number}: ${when}`);
    }
    if (hold > now) log(`CodeRabbit's allowance is back at ${iso(hold)}`);
    const next = nextAsk(waiting, hold, now);
    if (!next.pull && !next.at) return log("Nothing to ask for.");
    if (next.at) return log(`Next ask is due at ${iso(next.at)}; the first run after that asks.`);
    const { number, ask: command } = next.pull;
    if (dryRun) return log(`Would post "${command}" on #${number} now.`);
    const ask = await poster.request(`issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: footer ? `${command}\n\n${footer}` : command }),
    });
    asks++;
    log(`::notice::Posted "${command}" on #${number}`);
    const { outcome, reply } = await awaitAnswer(github, number, time(ask.created_at), { clock, pause });
    log(`#${number}: ${outcome}${outcome === "declined" ? ` (${declineReason(reply.body)})` : ""}`);
    if (outcome === "none") {
      log(`::warning::CodeRabbit didn't answer @${asker}'s ask on #${number}; it isn't repeated for this commit`);
    }
    // Accepted: the allowance may cover another, so on to the next pull request. Refused: the refusal holds every ask
    // back, and a later run reads it.
    if (outcome !== "accepted") return;
  }
}

async function main() {
  const { GITHUB_API_URL = "https://api.github.com", GITHUB_REPOSITORY, GH_TOKEN, ASK_TOKEN, DRY_RUN } = process.env;
  if (!GITHUB_REPOSITORY || !GH_TOKEN) {
    console.log("::error::GH_TOKEN and GITHUB_REPOSITORY are needed");
    process.exit(1);
  }
  const github = client({ apiUrl: GITHUB_API_URL, repository: GITHUB_REPOSITORY, token: GH_TOKEN });
  const poster = ASK_TOKEN && client({ apiUrl: GITHUB_API_URL, repository: GITHUB_REPOSITORY, token: ASK_TOKEN });
  const asker = poster ? (await poster.user()).login : null;
  if (!poster) console.log("::warning::No ASK_TOKEN (the CODERABBIT_ASK_TOKEN secret), so nothing is posted.");
  else console.log(`Asking as @${asker}.`);
  await askDue({ github, poster, asker, dryRun: DRY_RUN === "true" || !poster, footer: banner(GITHUB_REPOSITORY) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.log(`::error::${error.message}`);
    process.exit(1);
  });
}
