// Asks CodeRabbit for the reviews a pull request is owed. Run by coderabbit-retry.yml whenever a CodeRabbit check
// finishes or a pull request is pushed to: a run asks for what's due, then waits in the run for what comes next (the
// allowance back, a check that should have started, a review settling) for up to RUN_MINUTES, and starts the next run
// if something is still to come. A newer run replaces a waiting one.
//
// For each open pull request (drafts, paused ones and ones whose description says `@coderabbitai ignore` aside), the
// newest thing since its head commit decides:
//   - the commit itself, with no CodeRabbit review of it: `full review` if CodeRabbit never reviewed the pull request,
//     else `review`. A head CodeRabbit reviewed without a word (its check "Finished", no review posted) gets a
//     `full review`, as a plain one would be declined as "Already reviewed the last commit";
//   - CodeRabbit refusing an ask under its rate limit: the same ask again once the wait it gave is over;
//   - CodeRabbit declining as "Already reviewed the last commit", or finishing a plain review without a word:
//     `full review`;
//   - a review of the head, a full review taken, or an ask still unanswered: nothing.
// Every notice and refusal, on any pull request, says when the allowance is back, and the latest holds back every ask,
// so at most one is refused per window. Asks go one at a time, the longest-waiting pull request first.
//
// CodeRabbit doesn't answer commands from bot accounts (github-actions[bot] was ignored), so the asks are posted with
// ASK_TOKEN, an ordinary account's token; an ask it leaves unanswered isn't repeated for that commit.
//
// Usage: node coderabbit-retry.mjs, with GH_TOKEN (reads, and starts the next run), ASK_TOKEN (posts), GITHUB_API_URL,
// GITHUB_REPOSITORY and RUN_MINUTES (0, the default, asks what's due and stops) set. Without ASK_TOKEN, or with
// DRY_RUN=true, it only says what it would ask and when.

import { pathToFileURL } from "node:url";

export const CODERABBIT = "coderabbitai[bot]";
export const ASK = "@coderabbitai review";
export const FULL_ASK = "@coderabbitai full review";
const RATE_LIMIT_MARKER = "rate limited by coderabbit.ai";
const SUMMARY_MARKER = "summarize by coderabbit.ai";
const REPLY_MARKER = "auto-generated reply by coderabbit";
// In the summary once CodeRabbit has reviewed the pull request.
const WALKTHROUGH_MARKER = "walkthrough_start";

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
// CodeRabbit answers an ask within seconds.
const ANSWER_WAIT_MS = 3 * MINUTE;
const ANSWER_GRACE_MS = 10 * MINUTE;
// CodeRabbit starts on a push within a minute or two and finishes within minutes; past these it isn't coming.
const MISSED_HEAD_MS = 15 * MINUTE;
const STUCK_REVIEW_MS = 60 * MINUTE;
// A review CodeRabbit has just finished may still be posting its comments.
const SETTLE_MS = 3 * MINUTE;
// A waiting run looks again just after the time it waited for, and never sooner than this after its last look.
const WAKE_MARGIN_MS = 1000;
const MIN_PAUSE_MS = 30_000;

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
 * Whether a pull request is waiting for an ask. Returns { waiting: false, reason, recheck? } or { waiting: true,
 * since, notBefore, why, ask, limited }: since orders the queue, notBefore is the earliest time this pull request's
 * own notices allow an ask, why says which rule for the log, ask is the command, and limited says its head was rate
 * limited, so its summary's notice holds back every ask. recheck is when a pull request not waiting may be, with
 * nothing new happening: a check that should have started, an answer that should have come, a review settling.
 */
export function pullState({ pull, checkRuns, headDate, comments, reviews = [], now, asker }) {
  const no = (reason, recheck) => (recheck ? { waiting: false, reason, recheck } : { waiting: false, reason });
  const wait = ({ since, notBefore = since, why, ask, limited = false }) => ({
    waiting: true,
    since,
    notBefore,
    why,
    ask,
    limited,
  });
  if (/@coderabbitai\s+ignore\b/i.test(pull.body ?? "")) return no("its description has @coderabbitai ignore");
  const lastSwitch = comments
    .filter((c) => !byCodeRabbit(c) && /^\s*@coderabbitai\s+(pause|resume)\b/i.test(c.body ?? ""))
    .at(-1);
  if (lastSwitch && /pause/i.test(lastSwitch.body)) {
    return no(`paused by @${lastSwitch.user.login} at ${lastSwitch.created_at}`);
  }
  const check = latestCheck(checkRuns);
  if (check && check.status !== "completed" && !stuck(check, now)) {
    return no("CodeRabbit is reviewing it", time(check.started_at) + STUCK_REVIEW_MS);
  }
  const ourAsks = comments.filter((c) => c.user?.login === asker && isAsk(c) && time(c.created_at) > headDate);
  if (ourAsks.length >= MAX_ASKS_PER_COMMIT) return no(`asked ${ourAsks.length} times for this commit already`);

  // What happened since the push, oldest first: asks, CodeRabbit's answers, and its reviews of the head.
  const events = [];
  for (const c of comments) {
    if (time(c.created_at) <= headDate) continue;
    if (isAsk(c)) events.push({ kind: "ask", at: time(c.created_at), comment: c });
    else if (isReply(c)) events.push({ kind: "reply", at: time(c.created_at), comment: c });
  }
  for (const r of reviews) {
    if (r.user?.login === CODERABBIT && r.commit_id === pull.head?.sha) {
      events.push({ kind: "review", at: time(r.submitted_at) });
    }
  }
  events.sort((a, b) => a.at - b.at);
  // Someone else's ask that CodeRabbit ignored changes nothing; ours isn't repeated.
  const ignored = (e, i) =>
    e.kind === "ask" &&
    e.comment.user?.login !== asker &&
    now - e.at >= ANSWER_GRACE_MS &&
    !events.slice(i + 1).some((n) => n.kind === "reply");
  const last = events.filter((e, i) => !ignored(e, i)).at(-1);

  if (last?.kind === "review") return no(`CodeRabbit reviewed it at ${iso(last.at)}`);
  if (last?.kind === "ask") {
    if (now - last.at < ANSWER_GRACE_MS) {
      return no(`asked at ${last.comment.created_at}, no answer yet`, last.at + ANSWER_GRACE_MS);
    }
    return no(`CodeRabbit didn't answer the ask at ${last.comment.created_at}`);
  }
  if (last?.kind === "reply") {
    const reply = last.comment;
    const ask = comments.filter((c) => isAsk(c) && time(c.created_at) <= last.at).at(-1);
    const full = Boolean(ask && isFullAsk(ask));
    const outcome = replyOutcome(reply.body);
    if (outcome === "refused") {
      // A refusal often names no time, but the summary edited along with it does.
      const notices = noticesFrom(comments, now).filter((n) => n.at >= last.at - 2 * MINUTE);
      return wait({
        since: last.at,
        notBefore: notices.length ? Math.max(...notices.map((n) => n.until)) : last.at + UNKNOWN_WAIT_MS + MARGIN_MS,
        why: `refused at ${iso(last.at)}`,
        ask: full ? FULL_ASK : ASK,
        limited: true,
      });
    }
    if (outcome === "declined") {
      if (/already\s+reviewed/i.test(plain(reply.body))) {
        return wait({ since: last.at, why: "CodeRabbit had already reviewed the last commit", ask: FULL_ASK });
      }
      return no(`CodeRabbit declined: ${declineReason(reply.body)}`);
    }
    if (outcome !== "accepted") return no(`CodeRabbit's answer at ${reply.created_at} isn't one this knows`);
    if (full) return no(`CodeRabbit took the full review asked for at ${ask.created_at}`);
    // A plain review it finished: with a review posted that would be the newest thing, so this one found nothing.
    if (!/finished/i.test(plain(reply.body))) {
      if (now - last.at < STUCK_REVIEW_MS) {
        return no(`CodeRabbit took the ask at ${reply.created_at}`, last.at + STUCK_REVIEW_MS);
      }
      return wait({ since: last.at, why: `the review taken at ${reply.created_at} never finished`, ask: ASK });
    }
    const done = time(reply.updated_at);
    if (now - done < SETTLE_MS) return no("CodeRabbit only just finished", done + SETTLE_MS);
    return wait({ since: done, why: "the review asked for found nothing to say", ask: FULL_ASK });
  }

  // Nothing since the push.
  if (!check && now - headDate < MISSED_HEAD_MS) {
    return no("no CodeRabbit check on its head yet", headDate + MISSED_HEAD_MS);
  }
  if (check?.status === "completed" && now - time(check.completed_at) < SETTLE_MS) {
    return no("CodeRabbit only just finished", time(check.completed_at) + SETTLE_MS);
  }
  if (check?.conclusion === "success") {
    const since = time(check.completed_at);
    return wait({ since, why: "CodeRabbit reviewed the push without a word", ask: FULL_ASK });
  }
  const reviewedBefore =
    reviews.some((r) => r.user?.login === CODERABBIT) ||
    comments.some((c) => isSummary(c) && c.body.includes(WALKTHROUGH_MARKER));
  const summary = comments.find(isSummary);
  const limited = check ? rateLimited(check) : Boolean(summary?.body.includes(RATE_LIMIT_MARKER));
  const own = limited ? noticesFrom(comments, now).filter((n) => n.kind === "summary" && n.at >= headDate) : [];
  const notBefore = own.length
    ? Math.max(...own.map((n) => n.until))
    : limited
      ? headDate + UNKNOWN_WAIT_MS + MARGIN_MS
      : headDate;
  const said = check ? `CodeRabbit's check on the push says "${check.output?.title ?? check.conclusion}"` : "";
  return wait({
    since: headDate,
    notBefore,
    why: said || `CodeRabbit never picked up the push of ${iso(headDate)}`,
    ask: reviewedBefore ? ASK : FULL_ASK,
    limited,
  });
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
    const text = await res.text();
    return text ? JSON.parse(text) : null;
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
    const commit = await github.request(`commits/${pull.head.sha}`);
    const comments = await github.all(`issues/${pull.number}/comments`);
    const reviews = await github.all(`pulls/${pull.number}/reviews`);
    const headDate = time(commit.commit.committer.date);
    states.push({ number: pull.number, ...pullState({ pull, checkRuns, headDate, comments, reviews, now, asker }) });
  }
  const waiting = states.filter((state) => state.waiting);
  let hold = 0;
  if (waiting.length) {
    // A summary is edited in place and can keep an old notice after a review, so only a rate-limited head's summary
    // counts; a refusal anywhere means the allowance is spent for all of them.
    const limited = new Set(waiting.filter((state) => state.limited).map((state) => state.number));
    const recent = await github.all(`issues/comments?since=${iso(now - NOTICE_HORIZON_MS)}`);
    for (const notice of noticesFrom(recent, now)) {
      if (notice.kind === "refusal" || limited.has(notice.pr)) hold = Math.max(hold, notice.until);
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
 * One run: asks for each pull request that's due, one at a time, looking again after each ask, and waits in between
 * for the next ask or recheck until `until`. Returns { at } when the next of those comes later than that, so another
 * run has to look then, or {} when nothing is to come.
 */
export async function askDue({
  github,
  poster,
  asker,
  dryRun,
  footer = "",
  until = 0,
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
    if (!next.pull) {
      const wake = Math.min(next.at ?? Infinity, ...states.map((state) => state.recheck ?? Infinity));
      if (wake === Infinity) {
        log("Nothing to ask for.");
        return {};
      }
      const what = wake === next.at ? "Next ask is due" : "Looking again";
      if (wake > until) {
        if (now >= until) {
          log(`${what} at ${iso(wake)}, after this run's time.`);
          return { at: wake };
        }
        // Looks once more at the end of its time, so a run hands over at most once in that time.
        log(`${what} at ${iso(wake)}; looking again at the end of this run, ${iso(until)}.`);
        await pause(Math.max(until - now, MIN_PAUSE_MS));
        continue;
      }
      log(`${what} at ${iso(wake)}; waiting.`);
      await pause(Math.max(wake - now + WAKE_MARGIN_MS, MIN_PAUSE_MS));
      continue;
    }
    const { number, ask: command } = next.pull;
    if (dryRun) {
      log(`Would post "${command}" on #${number} now.`);
      return {};
    }
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
    // back until the time it gives, which the next look reads.
  }
  log(`::warning::Asked ${MAX_ASKS_PER_RUN} times in this run; the next run goes on.`);
  return {};
}

async function main() {
  const {
    GITHUB_API_URL = "https://api.github.com",
    GITHUB_REPOSITORY,
    GITHUB_REF_NAME,
    GITHUB_WORKFLOW_REF,
    GH_TOKEN,
    ASK_TOKEN,
    DRY_RUN,
    RUN_MINUTES,
  } = process.env;
  if (!GITHUB_REPOSITORY || !GH_TOKEN) {
    console.log("::error::GH_TOKEN and GITHUB_REPOSITORY are needed");
    process.exit(1);
  }
  const github = client({ apiUrl: GITHUB_API_URL, repository: GITHUB_REPOSITORY, token: GH_TOKEN });
  const poster = ASK_TOKEN && client({ apiUrl: GITHUB_API_URL, repository: GITHUB_REPOSITORY, token: ASK_TOKEN });
  const asker = poster ? (await poster.user()).login : null;
  if (!poster) console.log("::warning::No ASK_TOKEN (the CODERABBIT_ASK_TOKEN secret), so nothing is posted.");
  else console.log(`Asking as @${asker}.`);
  const dryRun = DRY_RUN === "true" || !poster;
  // A dry run only says what's due; a real one waits for what comes within its time.
  const minutes = Number(RUN_MINUTES) || 0;
  const until = dryRun || minutes <= 0 ? 0 : Date.now() + minutes * MINUTE;
  const { at } = await askDue({ github, poster, asker, dryRun, footer: banner(GITHUB_REPOSITORY), until });
  // Only a run that had time hands over: it waited all of it first, so runs can't start each other in a loop. Nothing
  // else may start one by then, as GitHub fires few of the scheduled runs.
  if (!at || !until || !GITHUB_WORKFLOW_REF) return;
  const workflow = GITHUB_WORKFLOW_REF.split("@")[0].split("/").pop();
  await github.request(`actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: GITHUB_REF_NAME }),
  });
  console.log(`Started the next run, for ${iso(at)}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.log(`::error::${error.message}`);
    process.exit(1);
  });
}
