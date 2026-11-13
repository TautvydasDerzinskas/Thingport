// Whether a migration is preparing or running, for what mustn't happen meanwhile, such as a switch to another
// database. On its own, so those can ask without loading the migration's code.

let busy = false;

export function migrationBusy(): boolean {
  return busy;
}

export function setMigrationBusy(value: boolean): void {
  busy = value;
}
