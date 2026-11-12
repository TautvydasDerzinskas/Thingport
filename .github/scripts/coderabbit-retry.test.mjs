// Run with: node --test .github/scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK,
  CODERABBIT,
  MAX_ASKS_PER_COMMIT,
  latestCheck,
  nextAsk,
  noticesFrom,
  pullState,
  replyOutcome,
  waitFrom,
} from "./coderabbit-retry.mjs";

const MINUTE = 60_000;
const ASKER = "thingport-bot";

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
const state = (overrides) =>
  pullState({
    pull: { number: 7, body: "" },
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
  // No notice: nothing says it was refused.
  const reviewed = [comment(CODERABBIT, SUMMARY_DONE, -60)];
  assert.equal(state({ checkRuns: [], headDate: at(1), comments: reviewed }).waiting, false);
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
