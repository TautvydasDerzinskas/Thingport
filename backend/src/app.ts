import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { resolveCorsOrigins } from "./cors";
import { HttpError } from "./utils/fileUtils";
import { trackClients } from "./services/clientActivityService";
import { pathToken, requireAuth } from "./auth";

import healthRoutes from "./routes/health";
import mcpRoutes from "./routes/mcp";
import iconRoutes from "./routes/icons";
import captchaRoutes from "./routes/captcha";
import authRoutes from "./routes/auth";
import oidcRoutes from "./routes/oidc";
import grabRoutes from "./routes/grab";
import printsRoutes from "./routes/prints";
import modelRepairRoutes from "./routes/modelRepair";
import authorsRoutes from "./routes/authors";
import platesRoutes from "./routes/plates";
import previewImagesRoutes from "./routes/previewImages";
import categoriesRoutes from "./routes/categories";
import printFilesRoutes from "./routes/printFiles";
import tagsRoutes from "./routes/tags";
import settingsRoutes from "./routes/settings";
import importsRoutes from "./routes/imports";
import importQueueRoutes from "./routes/importQueue";
import providerRoutes, { providerBodyLimits } from "./providers/routes";
import collectionsRoutes from "./routes/collections";
import collectionSyncsRoutes from "./routes/collectionSyncs";
import providerCollectionsRoutes from "./routes/providerCollections";
import bookmarksRoutes from "./routes/bookmarks";
import searchRoutes from "./routes/search";
import notificationsRoutes from "./routes/notifications";
import releaseNotesRoutes from "./routes/releaseNotes";
import adminRoutes from "./routes/admin";
import dashboardRoutes from "./routes/dashboard";
import widgetRoutes from "./routes/widgets";
import toolRoutes from "./routes/tools";
import { toolLocks } from "./routes/toolLocks";
import activityRoutes from "./routes/activity";
import aiCategorizationRoutes from "./routes/aiCategorization";
import aiDescriptionRoutes from "./routes/aiDescriptions";

export function createApp(): Express {
  const app = express();

  const origins = resolveCorsOrigins();
  app.use(
    cors({
      origin: origins.includes("*") ? true : origins,
      credentials: true,
      exposedHeaders: ["X-Has-More", "X-Next-Offset", "X-Total-Count"],
    }),
  );

  app.use(pathToken);
  // A widget's script, HTML and fetch body are larger than the default 100 kB; their own validation sets the limits.
  app.use("/api/widgets", express.json({ limit: "8mb" }));
  // A tool's script and the values it keeps.
  app.use("/api/tools", express.json({ limit: "8mb" }));
  // upload_model's files come as base64 in the call: MCP_UPLOAD_MAX_BYTES, a third bigger, and some room.
  app.use("/api/mcp", express.json({ limit: "40mb" }));
  // A provider with no file to link sends the file itself in the body; each one states its own size. Signed in
  // first: a limit this far above the global one would otherwise buffer and parse anyone's hundreds of megabytes
  // before the route behind it turned the request away.
  for (const { paths, limit } of providerBodyLimits) app.use(paths, requireAuth, express.json({ limit }));
  app.use(express.json());
  app.use("/api", trackClients);
  // Refuses changes to the models and collections tools bring, whichever router would make them.
  app.use("/api", toolLocks);

  // The frontend's nginx proxies /api/* here unmodified.
  app.use("/api", healthRoutes);
  // Before the routers that apply requireAuth to every path: see routes/mcp.ts.
  app.use("/api", mcpRoutes);
  // Also before them: an icon's file is public.
  app.use("/api", iconRoutes);
  app.use("/api", captchaRoutes);
  app.use("/api", authRoutes);
  app.use("/api", oidcRoutes);
  app.use("/api", grabRoutes);
  app.use("/api", settingsRoutes);
  app.use("/api", printsRoutes);
  app.use("/api", modelRepairRoutes);
  app.use("/api", aiCategorizationRoutes);
  app.use("/api", aiDescriptionRoutes);
  app.use("/api", authorsRoutes);
  app.use("/api", platesRoutes);
  app.use("/api", previewImagesRoutes);
  app.use("/api", categoriesRoutes);
  app.use("/api", printFilesRoutes);
  app.use("/api", tagsRoutes);
  app.use("/api", providerRoutes);
  app.use("/api", importsRoutes);
  app.use("/api", importQueueRoutes);
  app.use("/api", collectionsRoutes);
  app.use("/api", collectionSyncsRoutes);
  app.use("/api", providerCollectionsRoutes);
  app.use("/api", bookmarksRoutes);
  app.use("/api", searchRoutes);
  app.use("/api", notificationsRoutes);
  app.use("/api", releaseNotesRoutes);
  // Own prefix: on bare /api, its requireAdmin would also run for every route mounted after it.
  app.use("/api/admin", adminRoutes);
  app.use("/api", dashboardRoutes);
  app.use("/api", widgetRoutes);
  app.use("/api", toolRoutes);
  app.use("/api", activityRoutes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ detail: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ detail: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    // The body parser's own errors: too large, malformed JSON.
    const status = (err as { status?: unknown; expose?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500 && (err as { expose?: unknown }).expose) {
      res.status(status).json({ detail: (err as Error).message });
      return;
    }
    console.error(err);
    res.status(500).json({ detail: "Internal server error" });
  });

  return app;
}
