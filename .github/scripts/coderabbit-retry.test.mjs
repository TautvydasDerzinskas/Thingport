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
const PULL = {
  number: 7,
  body: "",
  head: { sha: "c0ffee" },
  base: { ref: "develop", repo: { default_branch: "develop" } },
};
const state = (overrides) =>
  pullState({
    pull: PULL,
    checkRuns: limitedCheck(0),
    headDate: at(-1),
    comments: [comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 0 })],
    now: at(30),
    asker: ASKER,
    ...overrides,
  });

test("a rate-limited head waits until the published time has passed", () => {
  const result = state();
  assert.equal(result.waiting, true);
  assert.equal(result.since, at(0));
  assert.equal(result.notBefore, at(19) + 30_000);
});

test("a head CodeRabbit reviewed, or is reviewing, doesn't wait", () => {
  const finished = [{ ...limitedCheck(5)[0], id: 10, conclusion: "success", output: { title: "Finished" } }];
  assert.equal(state({ checkRuns: [...limitedCheck(0), ...finished] }).waiting, false);
  const running = [{ ...limitedCheck(5)[0], id: 10, status: "in_progress", completed_at: null }];
  assert.equal(state({ checkRuns: [...limitedCheck(0), ...running] }).waiting, false);
});

test("a push during a limit gets no check, and waits on the summary's notice", () => {
  const comments = [comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 0 })];
  assert.equal(state({ checkRuns: [], headDate: at(1), comments }).waiting, true);
  // Just pushed: CodeRabbit may not have picked it up yet.
  assert.equal(state({ checkRuns: [], headDate: at(29), comments }).waiting, false);
});

test("a push CodeRabbit never picked up is asked for", () => {
  const comments = [comment(CODERABBIT, SUMMARY_DONE, -60)];
  const missed = state({ checkRuns: [], headDate: at(1), comments });
  assert.equal(missed.waiting, true);
  assert.equal(missed.since, at(1));
  assert.equal(missed.notBefore, at(1));
  assert.match(missed.why, /never picked up the push/);
  // CodeRabbit usually starts within a minute or two.
  assert.match(state({ checkRuns: [], headDate: at(20), comments }).reason, /no CodeRabbit check on its head yet/);
  // It only reviews pull requests into the default branch on its own.
  const stacked = { ...PULL, base: { ref: "feat/x", repo: { default_branch: "develop" } } };
  assert.equal(state({ pull: stacked, checkRuns: [], headDate: at(1), comments }).waiting, false);
  const review = { user: { login: CODERABBIT }, commit_id: "c0ffee" };
  assert.match(state({ checkRuns: [], headDate: at(1), comments, reviews: [review] }).reason, /reviewed it/);
  const older = { ...review, commit_id: "decaf" };
  assert.equal(state({ checkRuns: [], headDate: at(1), comments, reviews: [older] }).waiting, true);
  // A refusal of an ask since the push is waited out.
  const refused = [...comments, comment(ASKER, ASK, 20), comment(CODERABBIT, REFUSED_WITH_TIME, 20)];
  assert.equal(state({ checkRuns: [], headDate: at(1), comments: refused }).notBefore, at(24) + 30_000);
  // So is an ask in flight.
  const asked = [...comments, comment("someone", ASK, 25)];
  assert.match(state({ checkRuns: [], headDate: at(1), comments: asked }).reason, /no answer yet/);
});

test("a review that never finished is asked for again", () => {
  const running = (minutes) => [{ ...limitedCheck(minutes)[0], status: "in_progress", completed_at: null }];
  const comments = [comment(CODERABBIT, SUMMARY_DONE, -60)];
  assert.match(state({ checkRuns: running(0), comments }).reason, /reviewing it/);
  const stuck = state({ checkRuns: running(-40), comments });
  assert.equal(stuck.waiting, true);
  assert.equal(stuck.since, at(-40));
  assert.match(stuck.why, /never finished/);
  const review = { user: { login: CODERABBIT }, commit_id: "c0ffee" };
  assert.equal(state({ checkRuns: running(-40), comments, reviews: [review] }).waiting, false);
});

test("a refused full review is asked for again as one", () => {
  const base = [comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 0 })];
  assert.equal(state().ask, ASK);
  const full = [...base, comment("someone", FULL_ASK, -0.5), comment(CODERABBIT, REFUSED, -0.4)];
  assert.equal(state({ comments: full }).ask, FULL_ASK);
  // One asked for an earlier commit doesn't carry over to a new one.
  assert.equal(state({ comments: full, headDate: at(-0.1) }).ask, ASK);
  // Only the command says which: the banner below it doesn't.
  const fullWithBanner = [
    ...base,
    comment(ASKER, `${FULL_ASK}\n\n${BANNER}`, -0.5),
    comment(CODERABBIT, REFUSED, -0.4),
  ];
  assert.equal(state({ comments: fullWithBanner }).ask, FULL_ASK);
  const plainWithBanner = [
    ...base,
    comment(ASKER, `${ASK}\n\nfull ${BANNER}`, -0.5),
    comment(CODERABBIT, REFUSED, -0.4),
  ];
  assert.equal(state({ comments: plainWithBanner }).ask, ASK);
});

test("a pull request someone paused is left alone until resumed", () => {
  const base = [comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 0 })];
  const paused = [...base, comment("someone", "@coderabbitai pause", 5)];
  assert.match(state({ comments: paused }).reason, /paused by @someone/);
  const resumed = [...paused, comment("someone", "@coderabbitai resume", 6)];
  assert.equal(state({ comments: resumed }).waiting, true);
  assert.equal(state({ pull: { number: 7, body: "Docs only.\n@coderabbitai ignore" } }).waiting, false);
});

test("an ask in flight, accepted or declined isn't repeated", () => {
  const base = [comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 0 })];
  const asked = [...base, comment(ASKER, ASK, 25)];
  assert.match(state({ comments: asked }).reason, /no answer yet/);
  // Ignored: asking the same way again would be ignored again.
  assert.match(state({ comments: asked, now: at(40) }).reason, /didn't answer the ask/);
  // Someone else's ignored ask (github-actions[bot]'s, say) doesn't stop ours.
  const ignored = [...base, comment("github-actions[bot]", ASK, 25)];
  assert.equal(state({ comments: ignored, now: at(40) }).waiting, true);
  const accepted = [...asked, comment(CODERABBIT, ACCEPTED, 25)];
  assert.match(state({ comments: accepted }).reason, /took the ask/);
  assert.equal(state({ comments: accepted, now: at(60) }).waiting, true);
  const declined = [...asked, comment(CODERABBIT, ALREADY_REVIEWED, 25)];
  assert.match(state({ comments: declined }).reason, /declined: Already reviewed the last commit\./);
  // A person's ask counts too, so CodeRabbit isn't asked twice.
  const theirs = [...base, comment("someone", "@coderabbitai full review", 28)];
  assert.match(state({ comments: theirs }).reason, /no answer yet/);
  // So does one with the banner below the command, though not a command mentioned within a sentence.
  const withBanner = [...base, comment(ASKER, `${ASK}\n\n${BANNER}`, 25)];
  assert.match(state({ comments: withBanner }).reason, /no answer yet/);
  const mention = [...base, comment("someone", "Should @coderabbitai review this?", 25)];
  assert.equal(state({ comments: mention }).waiting, true);
});

test("a refusal without a time waits longer each time, and the asks for a commit are capped", () => {
  const base = [comment(CODERABBIT, SUMMARY_LIMITED, -60, { updated: 0 })];
  const once = [...base, comment(ASKER, ASK, 20), comment(CODERABBIT, REFUSED, 20)];
  assert.equal(state({ comments: once }).notBefore, at(35) + 30_000);
  const twice = [...once, comment(ASKER, ASK, 36), comment(CODERABBIT, REFUSED, 36)];
  assert.equal(state({ comments: twice, now: at(40) }).notBefore, at(66) + 30_000);
  const asks = Array.from({ length: MAX_ASKS_PER_COMMIT }, (_, i) => [
    comment(ASKER, ASK, i + 1),
    comment(CODERABBIT, REFUSED, i + 1),
  ]).flat();
  assert.match(state({ comments: [...base, ...asks] }).reason, /asked 5 times/);
  // Asks for an earlier commit don't count against a new one.
  assert.equal(state({ comments: [...base, ...asks], headDate: at(10), now: at(90) }).waiting, true);
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

// A repository whose pull requests CodeRabbit refused at minute 0; it answers each ask with the pull request's answer.
function fakeRun({ now, answers }) {
  let clock = at(now);
  const pulls = Object.keys(answers).map((number) => ({
    ...PULL,
    number: Number(number),
    head: { sha: `sha${number}` },
  }));
  const comments = pulls.map((pull) => comment(CODERABBIT, SUMMARY_LIMITED, -60, { pr: pull.number, updated: 0 }));
  const get = (path) => {
    const [route, query] = path.split("?");
    const since = new URLSearchParams(query).get("since");
    const fresh = (list) => list.filter((c) => !since || Date.parse(c.updated_at) >= Date.parse(since));
    const onPull = route.match(/^issues\/(\d+)\/comments$/)?.[1];
    if (route === "pulls") return pulls;
    if (/^commits\/sha\d+\/check-runs$/.test(route)) return { check_runs: limitedCheck(0) };
    if (/^commits\/sha\d+$/.test(route)) return { commit: { committer: { date: isoAt(-1) } } };
    if (onPull) return fresh(comments.filter((c) => c.issue_url.endsWith(`/${onPull}`)));
    if (/^pulls\/\d+\/reviews$/.test(route)) return [];
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
  // Once they have: an accepted ask moves on to the next pull request, a refusal ends the run. Each ask carries the
  // banner under the command, and still counts as an ask, so #7 isn't asked again.
  const due = fakeRun({ now: 30, answers: { 7: ACCEPTED, 8: REFUSED, 9: ACCEPTED } });
  await due.run();
  assert.deepEqual(due.posted, [7, 8]);
  assert.equal(due.bodies[0], `${ASK}\n\n${BANNER}`);
  assert.ok(due.paused() <= 2 * 10_000, "only waits for CodeRabbit's answers");
});

test("the banner follows the reader's GitHub theme", () => {
  const html = banner("o/r");
  assert.match(
    html,
    /^<picture><source media="\(prefers-color-scheme: dark\)" srcset="[^"]+\/o\/r\/develop\/[^"]+-dark\.png">/,
  );
  assert.match(html, /<img src="[^"]+\/o\/r\/develop\/[^"]+-light\.png" alt="Thingport ♥ CodeRabbit"/);
});
