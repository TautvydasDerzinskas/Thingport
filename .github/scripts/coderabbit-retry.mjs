// Asks CodeRabbit again for the reviews its rate limit refused. Once the repository's allowance is used up, CodeRabbit
// marks a pushed commit "Review rate limited", says when the next review is available, and never comes back to it.
// Run by coderabbit-retry.yml whenever a CodeRabbit check finishes, and hourly in case one was missed.
//
// A pull request waits when CodeRabbit's newest check on its head says "Review rate limited" (or the head has no check
// and the summary comment still carries the rate-limit notice: a push during a limit gets none). Every notice and
// refusal, on any pull request, says when the allowance is back, and the latest of those holds back every ask, so at
// most one ask is refused per window. Asks go one at a time, the longest-waiting pull request first: a refusal starts
// a new wait, an accepted ask moves on to the next. Pull requests paused with `@coderabbitai pause` are left alone.
//
// CodeRabbit doesn't answer commands from bot accounts (github-actions[bot] was ignored), so the asks are posted with
// ASK_TOKEN, an ordinary account's token; an ask it leaves unanswered isn't repeated for that commit.
//
// Usage: node coderabbit-retry.mjs, with GH_TOKEN (reads), ASK_TOKEN (posts), GITHUB_API_URL and GITHUB_REPOSITORY
// set. Without ASK_TOKEN, or with DRY_RUN=true, it only says what it would ask and when; MAX_MINUTES (default 75) is
// how long a run may wait for the allowance.

import { pathToFileURL } from "node:url";

export const CODERABBIT = "coderabbitai[bot]";
export const ASK = "@coderabbitai review";
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
// CodeRabbit answers an ask within seconds, and a review it accepts shows up as a check within minutes.
const ANSWER_GRACE_MS = 10 * MINUTE;
const ACCEPTED_GRACE_MS = 30 * MINUTE;
// A push takes CodeRabbit a moment to pick up: a head without a check is only taken as skipped after this.
const NEW_HEAD_GRACE_MS = 3 * MINUTE;

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
const isAsk = (comment) =>
  !byCodeRabbit(comment) && /^\s*@coderabbitai\s+(full\s+)?review\s*$/i.test(comment.body ?? "");

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
 * notBefore }: since is when CodeRabbit refused its head (the queue order), notBefore the earliest time this pull
 * request's own notices allow an ask.
 */
export function pullState({ pull, checkRuns, headDate, comments, now, asker }) {
  const check = latestCheck(checkRuns);
  const summary = comments.find(isSummary);
  let since;
  if (check && check.status !== "completed") return { waiting: false, reason: "CodeRabbit is reviewing it" };
  if (check && /rate\s*limit/i.test(check.output?.title ?? "")) {
    since = time(check.completed_at);
  } else if (check) {
    return { waiting: false, reason: `CodeRabbit's check says "${check.output?.title ?? check.conclusion}"` };
  } else if (summary?.body.includes(RATE_LIMIT_MARKER) && now - headDate >= NEW_HEAD_GRACE_MS) {
    since = time(summary.updated_at);
  } else {
    return { waiting: false, reason: "no CodeRabbit check on its head yet" };
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

  // A refusal with no notice to go by (a summary not yet written) still gets the standard wait.
  const own = noticesFrom(comments, now).filter((notice) => notice.at >= since - 2 * MINUTE);
  const notBefore = own.length ? Math.max(...own.map((n) => n.until)) : since + UNKNOWN_WAIT_MS + MARGIN_MS;
  return { waiting: true, since, notBefore };
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
    // Only heads CodeRabbit refused, or never checked, need their comments read.
    if (check && !/rate\s*limit/i.test(check.output?.title ?? "")) {
      states.push({ number: pull.number, waiting: false, reason: `CodeRabbit's check says "${check.output?.title}"` });
      continue;
    }
    const commit = await github.request(`commits/${pull.head.sha}`);
    const comments = await github.all(`issues/${pull.number}/comments`);
    const headDate = time(commit.commit.committer.date);
    states.push({ number: pull.number, ...pullState({ pull, checkRuns, headDate, comments, now, asker }) });
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

async function awaitAnswer(github, number, askedAt, deadline) {
  while (Date.now() < deadline) {
    await sleep(10_000);
    const recent = await github.all(`issues/${number}/comments?since=${iso(askedAt)}`);
    const reply = recent.find((c) => isReply(c) && time(c.created_at) >= askedAt);
    if (reply) return { outcome: replyOutcome(reply.body) ?? "unclear", reply };
  }
  return { outcome: "none" };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const {
    GITHUB_API_URL = "https://api.github.com",
    GITHUB_REPOSITORY,
    GH_TOKEN,
    ASK_TOKEN,
    DRY_RUN,
    MAX_MINUTES,
  } = process.env;
  if (!GITHUB_REPOSITORY || !GH_TOKEN) {
    console.log("::error::GH_TOKEN and GITHUB_REPOSITORY are needed");
    process.exit(1);
  }
  const deadline = Date.now() + (Number(MAX_MINUTES) || 75) * MINUTE;
  const github = client({ apiUrl: GITHUB_API_URL, repository: GITHUB_REPOSITORY, token: GH_TOKEN });
  const poster = ASK_TOKEN && client({ apiUrl: GITHUB_API_URL, repository: GITHUB_REPOSITORY, token: ASK_TOKEN });
  const asker = poster ? (await poster.user()).login : null;
  if (!poster) console.log("::warning::No ASK_TOKEN (the CODERABBIT_ASK_TOKEN secret), so nothing is posted.");
  else console.log(`Asking as @${asker}.`);
  const dryRun = DRY_RUN === "true" || !poster;

  for (let asks = 0; asks < 10;) {
    const now = Date.now();
    const { states, waiting, hold } = await survey(github, { asker, now });
    for (const state of states) {
      const ready = state.waiting && iso(Math.max(hold, state.notBefore));
      const when = state.waiting ? `refused at ${iso(state.since)}, to be asked from ${ready}` : state.reason;
      console.log(`#${state.number}: ${when}`);
    }
    if (hold > now) console.log(`CodeRabbit's allowance is back at ${iso(hold)}`);
    const next = nextAsk(waiting, hold, now);
    if (!next.pull && !next.at) return console.log("Nothing to ask for.");
    if (next.at) {
      if (dryRun) return console.log(`Would ask at ${iso(next.at)}.`);
      if (next.at > deadline) return console.log(`Next ask is at ${iso(next.at)}, after this run; a later run asks.`);
      console.log(`Waiting until ${iso(next.at)}.`);
      await sleep(next.at - now);
      continue;
    }
    const { number } = next.pull;
    if (dryRun) return console.log(`Would ask CodeRabbit to review #${number} now.`);
    const ask = await poster.request(`issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: ASK }),
    });
    asks++;
    console.log(`::notice::Asked CodeRabbit to review #${number}`);
    const { outcome, reply } = await awaitAnswer(github, number, time(ask.created_at), Date.now() + 3 * MINUTE);
    console.log(`#${number}: ${outcome}${outcome === "declined" ? ` (${declineReason(reply.body)})` : ""}`);
    if (outcome === "none") {
      console.log(
        `::warning::CodeRabbit didn't answer @${asker}'s ask on #${number}; it isn't repeated for this commit`,
      );
    }
    // Refused: the next survey reads the refusal and waits it out. Accepted: on to the next pull request.
    if (outcome !== "refused" && outcome !== "accepted") return;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.log(`::error::${error.message}`);
    process.exit(1);
  });
}
