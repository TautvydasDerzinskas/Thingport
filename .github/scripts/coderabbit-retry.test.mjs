// Run with: node --test .github/scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK,
  CODERABBIT,
  FULL_ASK,
  MAX_ASKS_PER_COMMIT,
  askDue,
  banner,
  latestCheck,
  newerRun,
  nextAsk,
  noticesFrom,
  pullState,
  replyOutcome,
  waitFrom,
} from "./coderabbit-retry.mjs";

const MINUTE = 60_000;
const ASKER = "thingport-bot";
const BANNER = banner("o/r");

// CodeRabbit's texts as it posted them on pull requests.
const SUMMARY_LIMITED = `<!-- coderabbit-ai-generated:v1 -->

<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->

> [!WARNING]
> ## Review limit reached
>
> You've used all free OSS reviews for now. Wait for the free limit to reset to keep reviewing this public repository.
>
> **Next included review available in 19 minutes.**
>
> **Limit details:** You’ve used all 2 included reviews currently available.

<!-- end of auto-generated comment: rate limited by coderabbit.ai -->`;
const SUMMARY_DONE = `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- walkthrough_start -->
## Walkthrough
Retries Mozilla's API when it answers 429: Rate limit exceeded, waiting as told.`;
const OLD_NOTICE = `<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->
> ## Rate limit exceeded
> \`@someone\` has exceeded the limit for the number of commits that can be reviewed per hour. Please wait **10 minutes and 21 seconds** before requesting another review.`;
const reply = (summary, text) => `<!-- coderabbit-ai-generated:v1 -->

<!-- This is an auto-generated reply by CodeRabbit -->
<!-- CodeRabbit review command invocation: v2:f14cb2 -->
<details>
<summary>${summary}</summary>
<dl>
<dd>
<br>

${text}

</dd>
</dl>
</details>`;
const REFUSED_WITH_TIME = reply(
  "Action not completed",
  "Review rate limited.\n\n---\n\nYour included review limit is currently reached under our [Fair Usage Limits Policy](https://docs.coderabbit.ai/management/rate-limits#fair-usage-limits-policy). This review may still proceed through usage-based billing if eligible. Your next included review will be available in 4 minutes.",
);
const REFUSED = reply(
  "Action not completed",
  "Review rate limited.\n\n> Note: CodeRabbit is an incremental review system and does not re-review already reviewed commits. This command is applicable only when automatic reviews are paused.",
);
const ACCEPTED = reply(
  "Action performed",
  "Review finished.\n\n> Note: CodeRabbit is an incremental review system and does not re-review already reviewed commits.",
);
const FULL_ACCEPTED = reply("Action performed", "Full review finished.");
const ALREADY_REVIEWED = reply(
  "Action not completed",
  "Already reviewed the last commit. Use `@coderabbitai full review` to review all files again.",
);

test("reads the wait from every wording CodeRabbit has used", () => {
  assert.equal(waitFrom(SUMMARY_LIMITED), 19 * MINUTE);
  assert.equal(waitFrom(REFUSED_WITH_TIME), 4 * MINUTE);
  assert.equal(waitFrom(OLD_NOTICE), 10 * MINUTE + 21_000);
  assert.equal(waitFrom("**Next review available in:** **5 minutes**"), 5 * MINUTE);
  assert.equal(waitFrom("Next included review available in 1 minute."), MINUTE);
  assert.equal(waitFrom("Please wait **45 seconds** before requesting another review."), 45_000);
  assert.equal(waitFrom("Next included review available in 1 hour."), 60 * MINUTE);
  assert.equal(waitFrom(REFUSED), null);
  assert.equal(waitFrom(SUMMARY_DONE), null);
});

test("tells refusals, accepted asks and other answers apart", () => {
  assert.equal(replyOutcome(REFUSED), "refused");
  assert.equal(replyOutcome(REFUSED_WITH_TIME), "refused");
  assert.equal(replyOutcome(ACCEPTED), "accepted");
  assert.equal(replyOutcome(reply("✅ Actions performed", "Review triggered.")), "accepted");
  assert.equal(replyOutcome(ALREADY_REVIEWED), "declined");
  assert.equal(replyOutcome("Thanks, that looks right."), null);
});

test("takes the newest CodeRabbit check, ignoring other apps", () => {
  const runs = [
    {
      id: 1,
      app: { slug: "coderabbitai" },
      started_at: "2026-11-10T14:37:45Z",
      output: { title: "Review rate limited" },
    },
    { id: 2, app: { slug: "coderabbitai" }, started_at: "2026-11-10T14:59:13Z", output: { title: "Finished" } },
    { id: 3, app: { slug: "github-actions" }, started_at: "2026-11-10T15:10:00Z", output: { title: "check" } },
  ];
  assert.equal(latestCheck(runs).id, 2);
  assert.equal(latestCheck([runs[2]]), null);
});

const at = (minutes) => Date.parse("2026-11-12T12:00:00Z") + minutes * MINUTE;
const isoAt = (minutes) => new Date(at(minutes)).toISOString();
let nextId = 1;
const comment = (login, body, minutes, { pr = 7, updated } = {}) => ({
  id: nextId++,
  user: { login },
  body,
  created_at: isoAt(minutes),
  updated_at: isoAt(updated ?? minutes),
  issue_url: `https://api.github.com/repos/o/r/issues/${pr}`,
});
const limitedCheck = (minutes) => [
  {
    id: 9,
    app: { slug: "coderabbitai" },
    status: "completed",
    conclusion: "neutral",
    started_at: isoAt(minutes),
    completed_at: isoAt(minutes),
    output: { title: "Review rate limited" },
  },
];
const check = (title, conclusion, minutes, status = "completed") => [
  {
    id: 9,
    app: { slug: "coderabbitai" },
    status,
    conclusion,
    started_at: isoAt(minutes - 5),
    completed_at: status === "completed" ? isoAt(minutes) : null,
    output: { title },
  },
];
// CodeRabbit's check on a head it finished reviewing at minute 15, and on a stacked pull request.
const FINISHED = check("Finished", "success", 15);
const SKIPPED = check("Review skipped: reviews are disabled for this base branch", "skipped", 0);
const PULL = {
  number: 7,
  body: "",
  head: { sha: "c0ffee" },
  base: { ref: "develop", repo: { default_branch: "develop" } },
};
const REVIEW_BODY = "**Actionable comments posted: 1**";
const OLD_REVIEW = {
  id: 101,
  user: { login: CODERABBIT },
  body: REVIEW_BODY,
  commit_id: "decaf",
  submitted_at: isoAt(-120),
};
const HEAD_REVIEW = {
  id: 102,
  user: { login: CODERABBIT },
  body: REVIEW_BODY,
  commit_id: "c0ffee",
  submitted_at: isoAt(14),
};
// CodeRabbit answering a reply in a review thread: GitHub files it as a review of the head with no body.
const THREAD_REPLY = { id: 103, user: { login: CODERABBIT }, body: "", commit_id: "c0ffee", submitted_at: isoAt(25) };
const replyComment = { pull_request_review_id: 103, in_reply_to_id: 900 };
const SUMMARY = comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 0 });
// A pull request CodeRabbit reviewed before; its head, pushed at minute -1, was rate limited at 0.
const state = (overrides) =>
  pullState({
    pull: PULL,
    checkRuns: limitedCheck(0),
    headDate: at(-1),
    comments: [SUMMARY],
    reviews: [OLD_REVIEW],
    now: at(30),
    asker: ASKER,
    ...overrides,
  });

test("a push to a pull request CodeRabbit reviewed is left for someone to ask about", () => {
  // Rate limited or not, a push gets no review of its own: only an ask brings one.
  assert.match(state().reason, /a push is reviewed when someone asks/);
  assert.match(state({ checkRuns: FINISHED }).reason, /a push is reviewed when someone asks/);
  assert.match(state({ checkRuns: [], headDate: at(1) }).reason, /a push is reviewed when someone asks/);
  // A walkthrough in the summary counts as reviewed.
  const walkedThrough = [comment(CODERABBIT, SUMMARY_DONE, -60)];
  assert.equal(state({ reviews: [], comments: walkedThrough, checkRuns: SKIPPED }).waiting, false);
});

test("a first review that was rate limited, got stuck or never started is asked for again, never as a full one", () => {
  const limited = state({ reviews: [] });
  assert.equal(limited.waiting, true);
  assert.equal(limited.ask, ASK);
  assert.equal(limited.since, at(-1));
  assert.equal(limited.limited, true);
  // Not before the summary's 19 minutes have passed.
  assert.equal(limited.notBefore, at(19) + 30_000);
  // A push during a limit can get no check: the summary's notice still holds it back.
  assert.equal(state({ reviews: [], checkRuns: [] }).notBefore, at(19) + 30_000);
  // No check at all: asked for once CodeRabbit has had 15 minutes, when a waiting run looks again.
  const unchecked = state({ reviews: [], checkRuns: [], comments: [], headDate: at(20) });
  assert.match(unchecked.reason, /no CodeRabbit check/);
  assert.equal(unchecked.recheck, at(35));
  const missed = state({ reviews: [], checkRuns: [], comments: [], headDate: at(1) });
  assert.equal(missed.ask, ASK);
  assert.equal(missed.notBefore, at(1));
  assert.match(missed.why, /never picked up/);
  // Stuck: still running after an hour.
  const stuck = state({ reviews: [], comments: [], checkRuns: check("Review in progress", null, -40, "in_progress") });
  assert.equal(stuck.ask, ASK);
  // Finished or skipped without a review, and not for the limit: asking would get the same.
  assert.match(state({ reviews: [], comments: [], checkRuns: FINISHED }).reason, /says "Finished"/);
  const stacked = { ...PULL, base: { ref: "feat/x", repo: { default_branch: "develop" } } };
  const skipped = state({ pull: stacked, checkRuns: SKIPPED, comments: [], reviews: [] });
  assert.equal(skipped.waiting, false);
  assert.match(skipped.reason, /Review skipped/);
});

test("a first review that finished without a word still counts once there's a newer push", () => {
  // Asked for at minute 5 and finished at 15 with no review posted and no walkthrough; then a push at minute 20.
  const quiet = [SUMMARY, comment(ASKER, ASK, 5), comment(CODERABBIT, ACCEPTED, 5, { updated: 15 })];
  const later = state({ reviews: [], comments: quiet, checkRuns: [], headDate: at(20), now: at(40) });
  assert.equal(later.waiting, false);
  assert.match(later.reason, /a push is reviewed when someone asks/);
  // A refused ask isn't a review: that first review is still owed.
  const refused = [SUMMARY, comment(ASKER, ASK, 5), comment(CODERABBIT, REFUSED, 5)];
  assert.equal(state({ reviews: [], comments: refused, checkRuns: [], headDate: at(20), now: at(40) }).waiting, true);
});

test("CodeRabbit's answer to a thread reply isn't a review of the head", () => {
  // An ask it refused, then a reply in a review thread: the refused ask is still owed.
  const refused = [SUMMARY, comment(ASKER, ASK, 20), comment(CODERABBIT, REFUSED, 20)];
  const owed = state({ comments: refused, reviews: [OLD_REVIEW, THREAD_REPLY], reviewComments: [replyComment] });
  assert.equal(owed.waiting, true);
  assert.equal(owed.ask, ASK);
  // Nor does it make a pull request count as reviewed.
  assert.equal(state({ reviews: [THREAD_REPLY], reviewComments: [replyComment] }).waiting, true);
  // A review with no body but a comment of its own on the code is a review.
  const topLevel = { pull_request_review_id: 103, in_reply_to_id: null };
  const reviewed = state({ comments: refused, reviews: [OLD_REVIEW, THREAD_REPLY], reviewComments: [topLevel] });
  assert.match(reviewed.reason, /reviewed it/);
});

test("a head CodeRabbit is reviewing, or reviewed with comments, is left alone", () => {
  const reviewing = state({ checkRuns: check("Review in progress", null, 25, "in_progress") });
  assert.match(reviewing.reason, /reviewing it/);
  assert.equal(reviewing.recheck, at(80));
  const reviewed = state({ checkRuns: FINISHED, reviews: [OLD_REVIEW, HEAD_REVIEW] });
  assert.match(reviewed.reason, /reviewed it/);
  assert.equal(reviewed.recheck, undefined);
});

test("a first review CodeRabbit finished without a word is left alone, once its comments have had time", () => {
  const settling = state({ reviews: [], comments: [], checkRuns: FINISHED, now: at(16) });
  assert.match(settling.reason, /only just finished/);
  assert.equal(settling.recheck, at(18));
  assert.equal(state({ reviews: [], comments: [], checkRuns: FINISHED }).waiting, false);
});

test("a refused ask is asked again the same way once the wait is over", () => {
  const plainRefused = [SUMMARY, comment(ASKER, ASK, 20), comment(CODERABBIT, REFUSED_WITH_TIME, 20)];
  const again = state({ comments: plainRefused });
  assert.equal(again.ask, ASK);
  assert.equal(again.since, at(20));
  assert.equal(again.notBefore, at(24) + 30_000);
  // The summary edited along with the refusal can name a later time than the refusal does.
  const edited = comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 20 });
  const later = state({ comments: [edited, comment(ASKER, ASK, 20), comment(CODERABBIT, REFUSED, 20)] });
  assert.equal(later.notBefore, at(39) + 30_000);
  assert.equal(later.limited, true);
  const fullRefused = [SUMMARY, comment("someone", FULL_ASK, 20), comment(CODERABBIT, REFUSED, 20)];
  assert.equal(state({ comments: fullRefused }).ask, FULL_ASK);
  // Only the command says which: the banner below it doesn't.
  const withBanner = [SUMMARY, comment(ASKER, `${FULL_ASK}\n\n${BANNER}`, 20), comment(CODERABBIT, REFUSED, 20)];
  assert.equal(state({ comments: withBanner }).ask, FULL_ASK);
  const fullInBanner = [SUMMARY, comment(ASKER, `${ASK}\n\nfull ${BANNER}`, 20), comment(CODERABBIT, REFUSED, 20)];
  assert.equal(state({ comments: fullInBanner }).ask, ASK);
});

test("a refusal without a time waits longer each time, and the asks for a commit are capped", () => {
  const once = [SUMMARY, comment(ASKER, ASK, 20), comment(CODERABBIT, REFUSED, 20)];
  assert.equal(state({ comments: once }).notBefore, at(35) + 30_000);
  const twice = [...once, comment(ASKER, ASK, 36), comment(CODERABBIT, REFUSED, 36)];
  assert.equal(state({ comments: twice, now: at(40) }).notBefore, at(66) + 30_000);
  const asks = Array.from({ length: MAX_ASKS_PER_COMMIT }, (_, i) => [
    comment(ASKER, ASK, i + 1),
    comment(CODERABBIT, REFUSED, i + 1),
  ]).flat();
  assert.match(state({ comments: [SUMMARY, ...asks] }).reason, /asked 5 times/);
  // Asks for an earlier commit don't count against a new one's.
  const newHead = [SUMMARY, ...asks, comment(ASKER, ASK, 20), comment(CODERABBIT, REFUSED, 20)];
  assert.equal(state({ comments: newHead, headDate: at(10), now: at(90) }).waiting, true);
});

test("Already reviewed the last commit is left alone, as are other declines", () => {
  const declined = [SUMMARY, comment(ASKER, ASK, 20), comment(CODERABBIT, ALREADY_REVIEWED, 20)];
  const already = state({ checkRuns: FINISHED, comments: declined });
  assert.equal(already.waiting, false);
  assert.match(already.reason, /declined: Already reviewed the last commit/);
  const changed = reply("Action not completed", "Head commit changed during the review.");
  const other = [SUMMARY, comment(ASKER, ASK, 20), comment(CODERABBIT, changed, 20)];
  assert.match(state({ comments: other }).reason, /declined: Head commit changed/);
});

test("a review asked for that finished without a word is left alone, and a full one ends it", () => {
  const asked = [SUMMARY, comment(ASKER, ASK, 5), comment(CODERABBIT, ACCEPTED, 5, { updated: 15 })];
  const quiet = state({ checkRuns: FINISHED, comments: asked });
  assert.equal(quiet.waiting, false);
  assert.match(quiet.reason, /found nothing to say/);
  assert.match(state({ checkRuns: FINISHED, comments: asked, now: at(16) }).reason, /only just finished/);
  // A review of the head posted after it is the newest thing.
  assert.match(state({ checkRuns: FINISHED, comments: asked, reviews: [HEAD_REVIEW] }).reason, /reviewed it/);
  const triggered = reply("✅ Actions performed", "Review triggered.");
  const running = [SUMMARY, comment(ASKER, ASK, 25), comment(CODERABBIT, triggered, 25)];
  assert.match(state({ comments: running }).reason, /took the ask/);
  assert.equal(state({ comments: running }).recheck, at(85));
  const fullTaken = [...asked, comment(ASKER, FULL_ASK, 20), comment(CODERABBIT, FULL_ACCEPTED, 20)];
  assert.match(state({ checkRuns: FINISHED, comments: fullTaken }).reason, /took the full review/);
});

test("an ask in flight isn't repeated, nor one CodeRabbit ignored", () => {
  const asked = [SUMMARY, comment(ASKER, ASK, 25)];
  assert.match(state({ comments: asked }).reason, /no answer yet/);
  assert.equal(state({ comments: asked }).recheck, at(35));
  assert.match(state({ comments: asked, now: at(40) }).reason, /didn't answer the ask/);
  // Someone else's ignored ask (github-actions[bot]'s, say) doesn't stop a re-ask that's due.
  const refused = [SUMMARY, comment(ASKER, ASK, 10), comment(CODERABBIT, REFUSED, 10)];
  const ignored = [...refused, comment("github-actions[bot]", ASK, 25)];
  assert.equal(state({ comments: ignored, now: at(40) }).waiting, true);
  // A person's ask counts, so CodeRabbit isn't asked twice; so does one with the banner below the command.
  assert.match(state({ comments: [SUMMARY, comment("someone", FULL_ASK, 28)] }).reason, /no answer yet/);
  assert.match(state({ comments: [SUMMARY, comment(ASKER, `${ASK}\n\n${BANNER}`, 25)] }).reason, /no answer yet/);
  // A command mentioned within a sentence isn't an ask.
  assert.equal(
    state({ comments: [...refused, comment("someone", "Should @coderabbitai review this?", 25)] }).waiting,
    true,
  );
});

test("a pull request someone paused is left alone until resumed", () => {
  const refused = [SUMMARY, comment(ASKER, ASK, 3), comment(CODERABBIT, REFUSED, 3)];
  const paused = [...refused, comment("someone", "@coderabbitai pause", 5)];
  assert.match(state({ comments: paused }).reason, /paused by @someone/);
  const resumed = [...paused, comment("someone", "@coderabbitai resume", 6)];
  assert.equal(state({ comments: resumed }).waiting, true);
  assert.equal(state({ pull: { ...PULL, body: "Docs only.\n@coderabbitai ignore" } }).waiting, false);
});

test("notices from every pull request, except summaries reading like one", () => {
  const notices = noticesFrom(
    [
      comment(CODERABBIT, SUMMARY_LIMITED, -60, { pr: 1, updated: 0 }),
      comment(CODERABBIT, REFUSED_WITH_TIME, 10, { pr: 2 }),
      comment(CODERABBIT, SUMMARY_DONE, 12, { pr: 3 }),
      comment("someone", "Review rate limited. Please wait 5 minutes", 12, { pr: 3 }),
      comment(CODERABBIT, REFUSED_WITH_TIME, -200, { pr: 4 }),
    ],
    at(20),
  );
  assert.deepEqual(
    notices.map(({ pr, kind, until }) => ({ pr, kind, until })),
    [
      { pr: 1, kind: "summary", until: at(19) + 30_000 },
      { pr: 2, kind: "refusal", until: at(14) + 30_000 },
    ],
  );
});

test("asks the longest-waiting pull request once the allowance is back", () => {
  const waiting = [
    { number: 12, since: at(10), notBefore: at(5) },
    { number: 9, since: at(2), notBefore: at(8) },
  ];
  assert.deepEqual(nextAsk(waiting, at(30), at(20)), { at: at(30) });
  assert.equal(nextAsk(waiting, at(30), at(31)).pull.number, 9);
  assert.deepEqual(nextAsk([{ number: 9, since: at(2), notBefore: at(40) }], at(30), at(31)), { at: at(40) });
  assert.deepEqual(nextAsk([], 0, at(0)), {});
});

// A repository of pull requests CodeRabbit reviewed before (unless reviewed is false), where someone asked for a review
// of each head and CodeRabbit refused it at minute 0 under its limit (unless refused is false), with checks saying
// the same unless checks says otherwise. It answers each ask with the pull request's answer, or the next of its
// answers, and with review, posts a review of the head for each ask it takes. A run may wait until minute `until`.
// A newer run starts at minute `newerAt`, if given.
function fakeRun({
  now,
  answers,
  checks = {},
  extra = [],
  until = 0,
  review = false,
  newerAt,
  refused = true,
  reviewed = true,
}) {
  let clock = at(now);
  const pulls = Object.keys(answers).map((number) => ({
    ...PULL,
    number: Number(number),
    head: { sha: `sha${number}` },
  }));
  const comments = [
    ...pulls.flatMap((pull) => [
      comment(CODERABBIT, SUMMARY_LIMITED, -60, { pr: pull.number, updated: 0 }),
      ...(refused
        ? [comment("someone", ASK, -0.5, { pr: pull.number }), comment(CODERABBIT, REFUSED, 0, { pr: pull.number })]
        : []),
    ]),
    ...extra,
  ];
  const get = (path) => {
    const [route, query] = path.split("?");
    const since = new URLSearchParams(query).get("since");
    const fresh = (list) => list.filter((c) => !since || Date.parse(c.updated_at) >= Date.parse(since));
    const onPull = route.match(/^issues\/(\d+)\/comments$/)?.[1];
    const checksOf = route.match(/^commits\/sha(\d+)\/check-runs$/)?.[1];
    if (route === "pulls") return pulls;
    if (checksOf) return { check_runs: checks[checksOf] ?? limitedCheck(0) };
    if (/^commits\/sha\d+$/.test(route)) return { commit: { committer: { date: isoAt(-1) } } };
    if (onPull) return fresh(comments.filter((c) => c.issue_url.endsWith(`/${onPull}`)));
    const reviewsOf = route.match(/^pulls\/(\d+)\/reviews$/)?.[1];
    if (reviewsOf) {
      return [...(reviewed ? [OLD_REVIEW] : []), ...reviews.filter((r) => r.commit_id === `sha${reviewsOf}`)];
    }
    if (/^pulls\/\d+\/comments$/.test(route)) return [];
    if (route === "issues/comments") return fresh(comments);
    throw new Error(`unexpected GET ${path}`);
  };
  const posted = [];
  const postedAt = [];
  const bodies = [];
  const reviews = [];
  const minutes = () => (clock - at(0)) / MINUTE;
  const answer = (pr) =>
    Array.isArray(answers[pr]) && answers[pr].length > 1 ? answers[pr].shift() : [answers[pr]].flat()[0];
  const poster = {
    async request(path, { body }) {
      const pr = Number(path.match(/^issues\/(\d+)\/comments$/)[1]);
      const ask = comment(ASKER, JSON.parse(body).body, minutes(), { pr });
      const said = answer(pr);
      comments.push(ask, comment(CODERABBIT, said, minutes() + 0.1, { pr }));
      if (review && replyOutcome(said) === "accepted") {
        reviews.push({
          id: 500 + reviews.length,
          user: { login: CODERABBIT },
          body: REVIEW_BODY,
          commit_id: `sha${pr}`,
          submitted_at: isoAt(minutes() + 0.15),
        });
      }
      posted.push(pr);
      postedAt.push(minutes());
      bodies.push(ask.body);
      return ask;
    },
  };
  let paused = 0;
  const github = { all: async (path, pick = (page) => page) => pick(get(path)), request: async (path) => get(path) };
  const options = {
    github,
    poster,
    asker: ASKER,
    dryRun: false,
    footer: BANNER,
    until: until && at(until),
    superseded: async () => (newerAt !== undefined && clock >= at(newerAt) ? { id: 2 } : null),
    clock: () => clock,
    pause: async (ms) => {
      paused += ms;
      clock += ms;
    },
    log: () => {},
  };
  const run = () => askDue(options);
  return { run, options, posted, postedAt, bodies, paused: () => paused };
}

test("with no time to wait, a run asks what's due and stops, leaving what isn't to a later run", async () => {
  // The summary's 19 minutes haven't passed: nothing is asked, and the run doesn't wait for them.
  const early = fakeRun({ now: 10, answers: { 7: ACCEPTED, 8: REFUSED } });
  assert.deepEqual(await early.run(), { at: at(19) + 30_000 });
  assert.deepEqual(early.posted, []);
  assert.equal(early.paused(), 0);
  // At minute 20 the summaries' notices are over and #7's own refusal named 4 minutes, but #8's refusal, which named
  // none, holds #7's re-ask back too: the allowance is the repository's.
  const refusals = [
    comment("someone", ASK, 9.9, { pr: 7 }),
    comment(CODERABBIT, REFUSED_WITH_TIME, 10, { pr: 7 }),
    comment("someone", ASK, 9.9, { pr: 8 }),
    comment(CODERABBIT, REFUSED, 10, { pr: 8 }),
  ];
  const held = fakeRun({ now: 20, answers: { 7: ACCEPTED, 8: ACCEPTED }, refused: false, extra: refusals });
  assert.deepEqual(await held.run(), { at: at(25) + 30_000 });
  assert.deepEqual(held.posted, []);
  // Once they have: an accepted ask moves on to the next pull request, a refusal ends the run. Each ask carries the
  // banner under the command, and still counts as an ask, so #7 isn't asked again.
  const due = fakeRun({ now: 30, answers: { 7: ACCEPTED, 8: REFUSED, 9: ACCEPTED } });
  await due.run();
  assert.deepEqual(due.posted, [7, 8]);
  assert.equal(due.bodies[0], `${ASK}\n\n${BANNER}`);
  assert.ok(due.paused() <= 2 * 10_000, "only waits for CodeRabbit's answers");
});

test("a run asks nothing where CodeRabbit had nothing to say, nor for a push since a review", async () => {
  // #7: a review asked for finished without a word. #8: a push, rate limited, to a pull request CodeRabbit reviewed.
  const asked = [comment(ASKER, ASK, 5, { pr: 7 }), comment(CODERABBIT, ACCEPTED, 5, { pr: 7, updated: 15 })];
  const run = fakeRun({
    now: 30,
    answers: { 7: FULL_ACCEPTED, 8: FULL_ACCEPTED },
    checks: { 7: FINISHED },
    extra: asked,
    refused: false,
  });
  assert.deepEqual(await run.run(), {});
  assert.deepEqual(run.posted, []);
});

test("a run waits in the run for what's due within its time", async () => {
  // Both heads wait for the summary's 19 minutes. #7's ask is refused for 4 more, which holds #8 back too; then the
  // longest waiting goes first, and once both are reviewed nothing is left to come.
  const run = fakeRun({
    now: 10,
    until: 130,
    review: true,
    answers: { 7: [REFUSED_WITH_TIME, ACCEPTED], 8: ACCEPTED },
  });
  assert.deepEqual(await run.run(), {});
  assert.deepEqual(run.posted, [7, 8, 7]);
  const [first, second] = run.postedAt;
  assert.ok(first >= 19.5 && first < 20, `asked at minute ${first}`);
  assert.ok(second >= first + 4.5 && second < first + 5, `asked again at minute ${second}`);
  assert.equal(run.bodies[2], `${ASK}\n\n${BANNER}`);
});

test("a run looks again when something should have changed, and hands over what comes after its time", async () => {
  // A pull request CodeRabbit never reviewed, with no check on its head yet: the run looks again once CodeRabbit has
  // had 15 minutes, finds the summary's notice holding the first review's ask past minute 15, waits out its own time
  // and hands the rest to the next run.
  const run = fakeRun({
    now: 5,
    until: 15,
    answers: { 7: ACCEPTED },
    checks: { 7: [] },
    refused: false,
    reviewed: false,
  });
  assert.deepEqual(await run.run(), { at: at(19) + 30_000 });
  assert.deepEqual(run.posted, []);
  assert.equal(run.paused(), 10 * MINUTE);
});

test("a waiting run leaves the rest to a newer one within a minute, and asks nothing once there is one", async () => {
  // Waiting for the summary's 19 minutes, a newer run starts at minute 12.
  const waiting = fakeRun({ now: 10, until: 130, answers: { 7: ACCEPTED }, newerAt: 12 });
  assert.deepEqual(await waiting.run(), {});
  assert.deepEqual(waiting.posted, []);
  assert.ok(waiting.paused() > 2 * MINUTE - 1000 && waiting.paused() <= 3 * MINUTE, `waited ${waiting.paused()} ms`);
  // One started after it with the ask already due doesn't post it either.
  const late = fakeRun({ now: 30, until: 130, answers: { 7: ACCEPTED }, newerAt: 0 });
  await late.run();
  assert.deepEqual(late.posted, []);
  // Nor does one whose newer run started while it was looking.
  let looks = 0;
  const racing = fakeRun({ now: 30, until: 130, answers: { 7: ACCEPTED } });
  const raced = await askDue({
    ...racing.options,
    superseded: async () => (++looks > 1 ? { id: 2 } : null),
  });
  assert.deepEqual(raced, {});
  assert.deepEqual(racing.posted, []);
});

test("a newer run counts only if it will do the work", async () => {
  const run = (id, event = "check_run", display_title = "CodeRabbit retry") => ({ id, event, display_title });
  const github = (runs, jobs) => ({
    request: async (path) => {
      const status = path.match(/^actions\/workflows\/retry\.yml\/runs\?status=(\w+)&/)?.[1];
      if (status) return { workflow_runs: runs[status] ?? [] };
      const id = Number(path.match(/^actions\/runs\/(\d+)\/jobs$/)[1]);
      return { jobs: jobs[id] ?? [] };
    },
  });
  const done = [{ status: "completed", conclusion: "skipped" }];
  const busy = [{ status: "in_progress" }];
  const runs = {
    queued: [run(5), run(9)],
    in_progress: [run(10), run(11, "pull_request_target"), run(12, "workflow_dispatch", "CodeRabbit retry (dry run)")],
  };
  // 5 is older, 11 only starts a run, 12 is a dry run, 10 skipped its job and 9 has none yet.
  const jobs = { 5: busy, 10: done, 11: busy, 12: busy };
  assert.equal(await newerRun(github(runs, jobs), "retry.yml", 8), null);
  const next = await newerRun(github(runs, { ...jobs, 9: [{ status: "queued" }] }), "retry.yml", 8);
  assert.equal(next.id, 9);
});

test("the banner follows the reader's GitHub theme", () => {
  const html = banner("o/r");
  assert.match(
    html,
    /^<picture><source media="\(prefers-color-scheme: dark\)" srcset="[^"]+\/o\/r\/develop\/[^"]+-dark\.png">/,
  );
  assert.match(html, /<img src="[^"]+\/o\/r\/develop\/[^"]+-light\.png" alt="Thingport ♥ CodeRabbit"/);
});
