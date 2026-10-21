import { SELF_AUTHOR_ID } from "../../../constants/selfAuthor";
import { bestScore, minScoreFor } from "./match";

// The app's own views, and Administration's for admins.
export type PageId =
  | "dashboard"
  | "models"
  | "collections"
  | "tags"
  | "downloads"
  | "myModels"
  | "profile"
  | "admin"
  | "adminProviders"
  | "adminStorage"
  | "adminAuth"
  | "adminRendering"
  | "adminAi"
  | "adminUsers"
  | "adminQueue"
  | "adminLogs"
  | "adminTriggers"
  | "adminConnections"
  | "adminCaptcha";

export type SearchPage = {
  id: PageId;
  path: string;
  /** The name as the sidebar or user menu shows it. */
  labelKey: string;
  /** Lower case; English whatever the UI language, as people often search in it anyway. */
  terms: string[];
  /** Found only by admins (the owner is one too); everyone else is sent away from it anyway. */
  adminOnly?: boolean;
};

// "admin" alone lists every one of them.
const ADMIN_TERMS = ["admin", "administration", "settings"];
const adminPage = (id: PageId, path: string, labelKey: string, terms: string[]): SearchPage => ({
  id,
  path,
  labelKey,
  terms: [...terms, ...ADMIN_TERMS],
  adminOnly: true,
});

export const SEARCH_PAGES: SearchPage[] = [
  { id: "dashboard", path: "/", labelKey: "app:sidebar.dashboard", terms: ["home", "overview", "stats"] },
  { id: "models", path: "/models", labelKey: "app:sidebar.models", terms: ["library", "prints", "all models"] },
  { id: "collections", path: "/models/collections", labelKey: "app:sidebar.collections", terms: ["collections"] },
  { id: "tags", path: "/models/tags", labelKey: "app:sidebar.tags", terms: ["tags", "labels"] },
  {
    id: "downloads",
    path: "/downloads",
    labelKey: "app:sidebar.downloads",
    terms: ["downloads", "bridge", "extension", "browser extension", "install"],
  },
  {
    id: "myModels",
    path: `/authors/${SELF_AUTHOR_ID}`,
    labelKey: "app:userMenu.myModels",
    terms: ["my models", "my uploads", "uploads", "mine"],
  },
  {
    id: "profile",
    path: "/profile",
    labelKey: "app:profile.title",
    terms: ["profile", "account", "email", "password", "activity", "heatmap", "contributions"],
  },
  adminPage("admin", "/admin", "app:sidebar.administration", [
    "overview",
    "system health",
    "health",
    "updates",
    "update checker",
    "version",
    "storage usage",
    "disk usage",
  ]),
  adminPage("adminProviders", "/admin-providers", "app:adminSettings.providers.heading", [
    "providers",
    "import sources",
    "makerworld",
    "printables",
    "thingiverse",
    "myminifactory",
    "snapmaker",
    "makeronline",
    "creality cloud",
    "nexprint",
    "thangs",
    "cults3d",
    "app token",
    "api key",
    "access token",
  ]),
  adminPage("adminStorage", "/admin-storage", "app:adminSettings.storageSettings.heading", [
    "storage",
    "storage structure",
    "consume folder",
    "browse files",
    "stored files",
    "disk",
  ]),
  adminPage("adminAuth", "/admin-auth", "app:adminSettings.auth.heading", [
    "auth",
    "authentication",
    "sign in",
    "login",
    "sign-in methods",
    "oidc",
    "sso",
    "registrations",
    "session length",
    "public url",
    "mcp",
    "ai assistant",
    "api token",
  ]),
  adminPage("adminRendering", "/admin-rendering", "app:adminSettings.rendering.heading", [
    "rendering",
    "previews",
    "model previews",
    "thumbnails",
  ]),
  adminPage("adminAi", "/admin-ai", "app:adminSettings.ai.heading", [
    "ai",
    "artificial intelligence",
    "categorization",
    "ai categorization",
    "descriptions",
    "llm",
  ]),
  adminPage("adminUsers", "/admin-users", "app:adminSettings.users.heading", [
    "users",
    "members",
    "roles",
    "accounts",
    "invite",
  ]),
  adminPage("adminQueue", "/admin-queue", "app:adminSettings.importQueue.heading", [
    "import queue",
    "queue",
    "imports",
    "jobs",
  ]),
  adminPage("adminLogs", "/admin-logs", "app:adminSettings.logs.heading", ["logs", "audit", "events"]),
  adminPage("adminTriggers", "/admin-triggers", "app:adminSettings.triggers.heading", [
    "triggers",
    "automation",
    "rules",
  ]),
  adminPage("adminConnections", "/admin-connections", "app:adminSettings.connections.heading", [
    "connections",
    "integrations",
  ]),
  adminPage("adminCaptcha", "/admin-captcha", "app:adminSettings.captcha.heading", [
    "captcha",
    "bot protection",
    "challenge",
  ]),
];

/** The pages this viewer may open. */
export const pagesFor = (isAdmin: boolean) => SEARCH_PAGES.filter((page) => isAdmin || !page.adminOnly);

/** The pages `query` matches, best first. `labels` are their names as shown. */
export function matchPages(query: string, labels: Record<PageId, string>, isAdmin: boolean): SearchPage[] {
  return pagesFor(isAdmin)
    .map((page) => ({ page, score: bestScore(query, labels[page.id], page.terms) }))
    .filter((match) => match.score >= minScoreFor(query))
    .toSorted((a, b) => b.score - a.score)
    .map((match) => match.page);
}
