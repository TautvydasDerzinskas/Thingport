// The storage tests' harness, for `import { ... } from "../harness"`: faults and pauses at the file door's checkpoints
// (lifecycle.ts), what a whole library looks like (invariants.ts), and the users and models to make one of (kit.ts).
// setup.ts loads lifecycle.ts alone: this file loads config.ts, which fixes the storage folder.

export { faults, hits, HarnessAborted, pauseAt, reached, track, type ErrnoCode, type Gate } from "./lifecycle";
export { checkLibraryInvariants, type Rule, type Scope, type Violation } from "./invariants";
export {
  useStorageKit,
  type FileSpec,
  type KitModel,
  type KitUser,
  type ModelSpec,
  type StorageKit,
  type ToolModel,
} from "./kit";
