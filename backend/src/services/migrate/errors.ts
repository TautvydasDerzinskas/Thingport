import { HttpError } from "../../utils/fileUtils";

/** Why a migration can't go on, by a code the app translates (adminSettings.migrate.errors.<code>), with the English
 *  for the log and for anything else that reads it. */
export class MigrateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly values: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "MigrateError";
  }
}

export type StoredError = { code: string; message: string; values?: Record<string, string | number> };

export function storedError(err: unknown): StoredError {
  if (err instanceof MigrateError) return { code: err.code, message: err.message, values: err.values };
  return { code: "unexpected", message: err instanceof Error ? err.message : String(err) };
}

/** A MigrateError as a request's answer: its code, and the values its sentence needs, for the app to translate. */
export class MigrateHttpError extends HttpError {
  readonly values: Record<string, string | number>;

  constructor(err: MigrateError, status = 400) {
    super(status, err.message, err.code);
    this.values = err.values;
  }
}
