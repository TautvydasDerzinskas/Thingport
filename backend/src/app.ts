import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { resolveCorsOrigins } from "./cors";
import { HttpError } from "./utils/fileUtils";

import healthRoutes from "./routes/health";
import captchaRoutes from "./routes/captcha";
import authRoutes from "./routes/auth";
import printsRoutes from "./routes/prints";
import authorsRoutes from "./routes/authors";
import platesRoutes from "./routes/plates";
import previewImagesRoutes from "./routes/previewImages";
import categoriesRoutes from "./routes/categories";
import printFilesRoutes from "./routes/printFiles";
import tagsRoutes from "./routes/tags";
import settingsRoutes from "./routes/settings";
import importsRoutes from "./routes/imports";
import collectionsRoutes from "./routes/collections";
import collectionSyncsRoutes from "./routes/collectionSyncs";
import bookmarksRoutes from "./routes/bookmarks";
import searchRoutes from "./routes/search";
import notificationsRoutes from "./routes/notifications";
import adminRoutes from "./routes/admin";
import dashboardRoutes from "./routes/dashboard";
import activityRoutes from "./routes/activity";
import aiCategorizationRoutes from "./routes/aiCategorization";

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

  app.use(express.json());

  // The frontend's nginx proxies /api/* here unmodified.
  app.use("/api", healthRoutes);
  app.use("/api", captchaRoutes);
  app.use("/api", authRoutes);
  app.use("/api", settingsRoutes);
  app.use("/api", printsRoutes);
  app.use("/api", aiCategorizationRoutes);
  app.use("/api", authorsRoutes);
  app.use("/api", platesRoutes);
  app.use("/api", previewImagesRoutes);
  app.use("/api", categoriesRoutes);
  app.use("/api", printFilesRoutes);
  app.use("/api", tagsRoutes);
  app.use("/api", importsRoutes);
  app.use("/api", collectionsRoutes);
  app.use("/api", collectionSyncsRoutes);
  app.use("/api", bookmarksRoutes);
  app.use("/api", searchRoutes);
  app.use("/api", notificationsRoutes);
  // Own prefix: on bare /api, its requireAdmin would also run for every route mounted after it.
  app.use("/api/admin", adminRoutes);
  app.use("/api", dashboardRoutes);
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
    console.error(err);
    res.status(500).json({ detail: "Internal server error" });
  });

  return app;
}
