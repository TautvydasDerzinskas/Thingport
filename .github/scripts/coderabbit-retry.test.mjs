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
const OLD_REVIEW = { user: { login: CODERABBIT }, commit_id: "decaf", submitted_at: isoAt(-120) };
const HEAD_REVIEW = { user: { login: CODERABBIT }, commit_id: "c0ffee", submitted_at: isoAt(14) };
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

test("a push CodeRabbit didn't review gets a review, or a full one if it never reviewed the pull request", () => {
  const limited = state();
  assert.equal(limited.waiting, true);
  assert.equal(limited.ask, ASK);
  assert.equal(limited.since, at(-1));
  assert.equal(limited.limited, true);
  // Not before the summary's 19 minutes have passed.
  assert.equal(limited.notBefore, at(19) + 30_000);
  assert.equal(state({ reviews: [] }).ask, FULL_ASK);
  // A walkthrough in the summary counts as reviewed.
  const walkedThrough = [comment(CODERABBIT, SUMMARY_DONE, -60)];
  assert.equal(state({ reviews: [], comments: walkedThrough, checkRuns: SKIPPED }).ask, ASK);
  // Stacked pull requests too, which CodeRabbit skips on its own.
  const stacked = { ...PULL, base: { ref: "feat/x", repo: { default_branch: "develop" } } };
  const skipped = state({ pull: stacked, checkRuns: SKIPPED, comments: [], reviews: [] });
  assert.equal(skipped.ask, FULL_ASK);
  assert.equal(skipped.notBefore, at(-1));
  assert.match(skipped.why, /Review skipped/);
  // No check at all: asked for once CodeRabbit has had 15 minutes.
  assert.match(state({ checkRuns: [], comments: [], headDate: at(20) }).reason, /no CodeRabbit check/);
  const missed = state({ checkRuns: [], comments: [], headDate: at(1) });
  assert.equal(missed.ask, ASK);
  assert.equal(missed.notBefore, at(1));
  assert.match(missed.why, /never picked up/);
  // A push during a limit can get no check: the summary's notice still holds it back.
  assert.equal(state({ checkRuns: [] }).notBefore, at(19) + 30_000);
});

test("a head CodeRabbit is reviewing, or reviewed with comments, is left alone", () => {
  assert.match(state({ checkRuns: check("Review in progress", null, 25, "in_progress") }).reason, /reviewing it/);
  // Unless that review never finished.
  assert.equal(state({ checkRuns: check("Review in progress", null, -40, "in_progress") }).waiting, true);
  assert.match(state({ checkRuns: FINISHED, reviews: [OLD_REVIEW, HEAD_REVIEW] }).reason, /reviewed it/);
});

test("a head CodeRabbit reviewed without a word gets a full review", () => {
  const quiet = state({ checkRuns: FINISHED });
  assert.equal(quiet.ask, FULL_ASK);
  assert.equal(quiet.since, at(15));
  assert.equal(quiet.limited, false);
  assert.match(quiet.why, /without a word/);
  // Its comments may still be on the way.
  assert.match(state({ checkRuns: FINISHED, now: at(16) }).reason, /only just finished/);
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
  // Asks for an earlier commit don't count against a new one.
  assert.equal(state({ comments: [SUMMARY, ...asks], headDate: at(10), now: at(90) }).waiting, true);
});

test("Already reviewed the last commit gets a full review; other declines are left alone", () => {
  const declined = [SUMMARY, comment(ASKER, ASK, 20), comment(CODERABBIT, ALREADY_REVIEWED, 20)];
  const full = state({ checkRuns: FINISHED, comments: declined });
  assert.equal(full.ask, FULL_ASK);
  assert.equal(full.notBefore, at(20));
  const changed = reply("Action not completed", "Head commit changed during the review.");
  const other = [SUMMARY, comment(ASKER, ASK, 20), comment(CODERABBIT, changed, 20)];
  assert.match(state({ comments: other }).reason, /declined: Head commit changed/);
});

test("a plain review that finished without a word gets a full review, and a full one ends it", () => {
  const asked = [SUMMARY, comment(ASKER, ASK, 5), comment(CODERABBIT, ACCEPTED, 5, { updated: 15 })];
  const owed = state({ checkRuns: FINISHED, comments: asked });
  assert.equal(owed.ask, FULL_ASK);
  assert.equal(owed.since, at(15));
  assert.match(owed.why, /found nothing/);
  assert.match(state({ checkRuns: FINISHED, comments: asked, now: at(16) }).reason, /only just finished/);
  // A review of the head posted after it is the newest thing.
  assert.match(state({ checkRuns: FINISHED, comments: asked, reviews: [HEAD_REVIEW] }).reason, /reviewed it/);
  const triggered = reply("✅ Actions performed", "Review triggered.");
  const running = [SUMMARY, comment(ASKER, ASK, 25), comment(CODERABBIT, triggered, 25)];
  assert.match(state({ comments: running }).reason, /took the ask/);
  const fullTaken = [...asked, comment(ASKER, FULL_ASK, 20), comment(CODERABBIT, FULL_ACCEPTED, 20)];
  assert.match(state({ checkRuns: FINISHED, comments: fullTaken }).reason, /took the full review/);
});

test("an ask in flight isn't repeated, nor one CodeRabbit ignored", () => {
  const asked = [SUMMARY, comment(ASKER, ASK, 25)];
  assert.match(state({ comments: asked }).reason, /no answer yet/);
  assert.match(state({ comments: asked, now: at(40) }).reason, /didn't answer the ask/);
  // Someone else's ignored ask (github-actions[bot]'s, say) doesn't stop ours.
  const ignored = [SUMMARY, comment("github-actions[bot]", ASK, 25)];
  assert.equal(state({ comments: ignored, now: at(40) }).waiting, true);
  // A person's ask counts, so CodeRabbit isn't asked twice; so does one with the banner below the command.
  assert.match(state({ comments: [SUMMARY, comment("someone", FULL_ASK, 28)] }).reason, /no answer yet/);
  assert.match(state({ comments: [SUMMARY, comment(ASKER, `${ASK}\n\n${BANNER}`, 25)] }).reason, /no answer yet/);
  // A command mentioned within a sentence isn't an ask.
  assert.equal(
    state({ comments: [SUMMARY, comment("someone", "Should @coderabbitai review this?", 25)] }).waiting,
    true,
  );
});

test("a pull request someone paused is left alone until resumed", () => {
  const paused = [SUMMARY, comment("someone", "@coderabbitai pause", 5)];
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

// A repository of pull requests CodeRabbit reviewed before, whose heads it refused at minute 0 unless checks says
// otherwise; it answers each ask with the pull request's answer.
function fakeRun({ now, answers, checks = {}, extra = [] }) {
  let clock = at(now);
  const pulls = Object.keys(answers).map((number) => ({
    ...PULL,
    number: Number(number),
    head: { sha: `sha${number}` },
  }));
  const comments = [
    ...pulls.map((pull) => comment(CODERABBIT, SUMMARY_LIMITED, -60, { pr: pull.number, updated: 0 })),
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
    if (/^pulls\/\d+\/reviews$/.test(route)) return [OLD_REVIEW];
    if (route === "issues/comments") return fresh(comments);
    throw new Error(`unexpected GET ${path}`);
  };
  const posted = [];
  const bodies = [];
  const minutes = () => (clock - at(0)) / MINUTE;
  const poster = {
    async request(path, { body }) {
      const pr = Number(path.match(/^issues\/(\d+)\/comments$/)[1]);
      const ask = comment(ASKER, JSON.parse(body).body, minutes(), { pr });
      comments.push(ask, comment(CODERABBIT, answers[pr], minutes() + 0.1, { pr }));
      posted.push(pr);
      bodies.push(ask.body);
      return ask;
    },
  };
  let paused = 0;
  const github = { all: async (path, pick = (page) => page) => pick(get(path)), request: async (path) => get(path) };
  const run = () =>
    askDue({
      github,
      poster,
      asker: ASKER,
      dryRun: false,
      footer: BANNER,
      clock: () => clock,
      pause: async (ms) => {
        paused += ms;
        clock += ms;
      },
      log: () => {},
    });
  return { run, posted, bodies, paused: () => paused };
}

test("a run asks what's due and stops, leaving what isn't to a later run", async () => {
  // The summary's 19 minutes haven't passed: nothing is asked, and the run doesn't wait for them.
  const early = fakeRun({ now: 10, answers: { 7: ACCEPTED, 8: REFUSED } });
  await early.run();
  assert.deepEqual(early.posted, []);
  assert.equal(early.paused(), 0);
  // #8's notice holds back #7's full review too: the allowance is the repository's.
  const held = fakeRun({ now: 18, answers: { 7: FULL_ACCEPTED, 8: ACCEPTED }, checks: { 7: FINISHED } });
  await held.run();
  assert.deepEqual(held.posted, []);
  // Once they have: an accepted ask moves on to the next pull request, a refusal ends the run. Each ask carries the
  // banner under the command, and still counts as an ask, so #7 isn't asked again.
  const due = fakeRun({ now: 30, answers: { 7: ACCEPTED, 8: REFUSED, 9: ACCEPTED } });
  await due.run();
  assert.deepEqual(due.posted, [7, 8]);
  assert.equal(due.bodies[0], `${ASK}\n\n${BANNER}`);
  assert.ok(due.paused() <= 2 * 10_000, "only waits for CodeRabbit's answers");
});

test("a run asks for full reviews where CodeRabbit had nothing to say", async () => {
  // #7: a review asked for finished without a word. #8: CodeRabbit reviewed the push on its own without a word.
  const asked = [comment(ASKER, ASK, 5, { pr: 7 }), comment(CODERABBIT, ACCEPTED, 5, { pr: 7, updated: 15 })];
  const run = fakeRun({
    now: 30,
    answers: { 7: FULL_ACCEPTED, 8: FULL_ACCEPTED },
    checks: { 7: FINISHED, 8: FINISHED },
    extra: asked,
  });
  await run.run();
  assert.deepEqual(run.posted, [7, 8]);
  assert.equal(run.bodies[0], `${FULL_ASK}\n\n${BANNER}`);
});

test("the banner follows the reader's GitHub theme", () => {
  const html = banner("o/r");
  assert.match(
    html,
    /^<picture><source media="\(prefers-color-scheme: dark\)" srcset="[^"]+\/o\/r\/develop\/[^"]+-dark\.png">/,
  );
  assert.match(html, /<img src="[^"]+\/o\/r\/develop\/[^"]+-light\.png" alt="Thingport ♥ CodeRabbit"/);
});
