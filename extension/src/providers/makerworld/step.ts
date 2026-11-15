import type { MakerworldJob } from "../../shared/messages";

/** The step a guided run is on: which run, which of its models, and how far through that model's profiles. The page
 *  says which one it resumes, and the run takes a resume only for the step it's on. */
export function makerworldStepKey(job: Pick<MakerworldJob, "runId" | "index" | "profiles">): string {
  return `${job.runId ?? ""}:${job.index}:${job.profiles?.done ?? 0}`;
}
