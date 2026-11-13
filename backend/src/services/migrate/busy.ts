// Whether a migration is preparing or running, or a discard is filing what one brought, for what mustn't happen
// meanwhile, such as a switch to another database. On its own, so those can ask without loading the migration's code.

let holds = 0;

export function migrationBusy(): boolean {
  return holds > 0;
}

/** Holds migrations busy until the returned release is called; each hold is released once, whatever ends first. */
export function holdMigrationBusy(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
  };
}
