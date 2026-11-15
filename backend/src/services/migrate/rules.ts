import type { Prisma } from "@prisma/client";

/** What brings a table over: the people themselves, who always come with their models, or one of the choices on
 *  What comes. */
export type MigratePart =
  "people" | "collections" | "studio" | "widgets" | "tools" | "syncs" | "signIns" | "settings" | "secrets";

export type TableRule = { part: MigratePart } | { never: string };

const PARTNERS = "Connected instances know the old instance by its address and keys: connect this one to them again.";

/** How a migration from another Thingport instance treats each table. A table added without a rule here doesn't
 *  compile, and merge.ts's MERGED_TABLES must match the ones that come (tests/migrate.test.ts), so new data is never
 *  left behind without someone deciding it should be. */
export const MERGE_RULES = {
  User: { part: "people" },
  Category: { part: "people" },
  CategorySiteId: { part: "people" },
  Print: { part: "people" },
  Plate: { part: "people" },
  PreviewImage: { part: "people" },
  DescriptionImage: { part: "people" },
  PrintFile: { part: "people" },
  Author: { part: "people" },
  AuthorLink: { part: "people" },
  Activity: { part: "people" },
  SystemReceipt: { part: "people" },
  UserPrinter: { part: "people" },
  UserIcon: { part: "people" },
  UserIdentity: { part: "people" },
  UserAchievement: { part: "people" },
  UserActiveDay: { part: "people" },
  Collection: { part: "collections" },
  CollectionItem: { part: "collections" },
  CollectionShare: { part: "collections" },
  Bookmark: { part: "collections" },
  CollectionSync: { part: "syncs" },
  ProviderListing: { part: "syncs" },
  ProviderConnection: { part: "signIns" },
  CustomWidget: { part: "widgets" },
  Tool: { part: "tools" },
  ToolData: { part: "tools" },
  StudioDesign: { part: "studio" },
  StudioRevision: { part: "studio" },
  StudioMessage: { part: "studio" },
  Setting: { part: "settings" },
  AiConnection: { part: "secrets" },
  OidcProvider: { part: "secrets" },
  Invitation: { never: "An invitation is to the old instance's address." },
  ImportJob: { never: "Import history and the import queue stay with the old instance." },
  ImportJobItem: { never: "Import history and the import queue stay with the old instance." },
  GrabImport: { never: "Imports waiting for Thingport Grab stay with the old instance." },
  Notification: { never: "Notifications are about what happened on the old instance." },
  GrabConnection: { never: "Thingport Grab connects to each instance on its own." },
  Session: { never: "Everyone signs in here again." },
  Log: { never: "The audit log is the old instance's." },
  Chat: { never: "Chats stay with the old instance." },
  ChatMember: { never: "Chats stay with the old instance." },
  ChatMessage: { never: "Chats stay with the old instance." },
  ChatAttachment: { never: "Chats stay with the old instance." },
  ChatRemoteMember: { never: "Chats stay with the old instance." },
  Peer: { never: PARTNERS },
  PeerRequest: { never: PARTNERS },
  RemotePerson: { never: PARTNERS },
  RemoteModel: { never: PARTNERS },
  RemoteCollection: { never: PARTNERS },
  RemoteCollectionViewer: { never: PARTNERS },
  RemoteGone: { never: PARTNERS },
  FederationDelivery: { never: PARTNERS },
  FederationKv: { never: PARTNERS },
  MigrationRun: { never: "This instance's own record of migrations." },
} satisfies Record<Prisma.ModelName, TableRule>;

/** The settings that come with "Instance settings": how the instance behaves, nothing that says which instance it
 *  is (its address, its keys) or that a job left half-done. */
export const SETTING_KEYS = [
  "allow_registrations",
  "captcha_login",
  "captcha_register",
  "captcha_import",
  "captcha_change_password",
  "captcha_change_email",
  "user_widgets_enabled",
  "community_widgets_enabled",
  "tools_access",
  "social",
  "simplify_previews",
  "quality_checks",
  "quality_checks_off",
  "preview_mode",
  "file_reuse",
  "license_files",
  "mcp_access",
  "disabled_providers",
  "consume_mode",
  "consume_user_id",
  "flaresolverr_url",
  "ai_categorization",
  "ai_descriptions",
  "studio_assistant",
  "auth_token_ttl_seconds",
  "remember_session_ttl_seconds",
] as const;

/** The settings that come with "Secrets", beside the AI services and sign-in providers: provider API keys and the
 *  mail server's password. */
export const SECRET_SETTING_KEYS = ["myminifactory_api_key", "thingiverse_access_token", "smtp_settings"] as const;
