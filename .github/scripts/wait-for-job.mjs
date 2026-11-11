// Waits for another workflow so the backend's and frontend's images, built by workflows of their own, go out in step.
// Run by build-image.yml's publish job, between pushing an image untagged and tagging it.
//
// With a job name (a release on main): waits until that job has succeeded in the other workflow's run for the same
// commit, or not at all when there's no such run (a merge that changes only this image). A failed job is waited on
// too, so re-running it finishes the release whichever half failed; after the time given this fails, untagged.
//
// Without one (develop's :dev): waits until the other workflow has no run queued or in progress on the branch,
// whatever its commit. Merges there come often enough to replace each other's runs, so pairing by commit would hold
// images back; this only keeps one from going out ahead of the other, and after the time given it goes out anyway.
//
// Usage: node wait-for-job.mjs <workflow file> <job name or ""> <minutes>

const [workflow, job, minutes] = process.argv.slice(2);
if (!workflow || !(Number(minutes) > 0)) {
  console.log(`::error::Usage: node wait-for-job.mjs <workflow file> <job name or ""> <minutes>`);
  process.exit(1);
}
const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME, GH_TOKEN } = process.env;
const deadline = Date.now() + Number(minutes) * 60_000;
// GITHUB_TOKEN may make 1,000 API requests an hour for the repository, shared by every workflow.
const POLL_MS = 15_000;
// How long no run for this commit is taken as "not yet created" before it means "not triggered".
const NO_RUN_GRACE_MS = 2 * 60_000;

async function api(path) {
  const res = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keeps asking until read() gives an answer or time runs out, so a failed request isn't taken for one.
async function poll(read) {
  let last;
  for (;;) {
    let state;
    try {
      state = await read();
    } catch (error) {
      state = { waiting: `unreadable (${error.message})` };
    }
    if (!state.waiting) return state;
    if (state.waiting !== last) console.log(state.waiting);
    last = state.waiting;
    if (Date.now() >= deadline) return { timedOut: true };
    await sleep(POLL_MS);
  }
}

async function runs(filters) {
  const query = new URLSearchParams({ event: "push", branch: GITHUB_REF_NAME, ...filters });
  const { workflow_runs } = await api(`actions/workflows/${workflow}/runs?${query}`);
  return workflow_runs;
}

if (!job) {
  const { timedOut } = await poll(async () => {
    // Newest first, so any still going are among these.
    const going = (await runs({ per_page: "20" })).filter((run) => run.status !== "completed");
    if (going.length === 0) return { done: true };
    return { waiting: `Waiting for ${going.map((run) => run.html_url).join(", ")} to finish.` };
  });
  if (timedOut) console.log(`::warning::${workflow} was still running after ${minutes} minutes; tagging anyway.`);
  else console.log(`${workflow} has nothing left running.`);
  process.exit(0);
}

// The same push starts both workflows, but GitHub may list the other's run a little later than this one's.
const noRunBy = Date.now() + NO_RUN_GRACE_MS;
const { run, timedOut: noRun } = await poll(async () => {
  const [found] = await runs({ head_sha: GITHUB_SHA, per_page: "1" });
  if (found) return { run: found };
  if (Date.now() < noRunBy) return { waiting: `No ${workflow} run for this commit yet.` };
  return { run: null };
});
if (noRun) {
  console.log(`::error::Couldn't read ${workflow}'s runs for ${minutes} minutes, so this image wasn't tagged.`);
  process.exit(1);
}
// Path-filtered: no run means this commit doesn't change that image, as in a hotfix to one of them.
if (!run) {
  console.log(`${workflow} didn't run for this commit, so this image goes out on its own.`);
  process.exit(0);
}

console.log(`Waiting for "${job}" in ${run.html_url}`);
const { timedOut } = await poll(async () => {
  // The latest attempt's jobs, so a re-run is seen.
  const { jobs } = await api(`actions/runs/${run.id}/jobs?per_page=100`);
  const found = jobs.find((candidate) => candidate.name === job);
  if (found?.conclusion === "success") return { done: true };
  if (found && found.status !== "completed") return { waiting: `"${job}" is ${found.status}.` };
  // A job skipped by its condition is listed by its caller's name alone, so it's missing from a finished run too.
  const { status } = found ? { status: "completed" } : await api(`actions/runs/${run.id}`);
  if (status !== "completed") return { waiting: `"${job}" hasn't started.` };
  return {
    waiting:
      `"${job}" ${found ? `ended in ${found.conclusion}` : "didn't run"}. Re-run its failed jobs to release both ` +
      `images; until then this one waits, rather than go out alone.`,
  };
});
if (timedOut) {
  console.log(`::error::Gave up on "${job}" in ${workflow} after ${minutes} minutes, so this image wasn't tagged.`);
  process.exit(1);
}
console.log(`"${job}" succeeded.`);
