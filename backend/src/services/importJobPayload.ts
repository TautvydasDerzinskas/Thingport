import { listImportSchema, profilesImportSchema, zipExtractRequestSchema } from "../routes/importRequest";

export type BatchType = "COLLECTION" | "ZIP" | "PROFILES";

export function batchPayload(type: BatchType, body: unknown) {
  const parsed =
    type === "COLLECTION"
      ? listImportSchema.parse(body)
      : type === "PROFILES"
        ? profilesImportSchema.parse(body)
        : zipExtractRequestSchema.parse(body);
  const {
    makerworld_cookie: _cookie,
    resolved_download_url: _download,
    resolved_files: _files,
    resolved_instance_id: _instance,
    makerworld_design: _design,
    ...stored
  } = parsed;
  return stored;
}
