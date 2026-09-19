import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { resolveCorsOrigins } from "./cors";
import { HttpError } from "./utils/fileUtils";

import healthRoutes from "./routes/health";
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
import bookmarksRoutes from "./routes/bookmarks";
import notificationsRoutes from "./routes/notifications";
import adminRoutes from "./routes/admin";
import dashboardRoutes from "./routes/dashboard";

export function createApp(): Express {
  const app = express();

  const origins = resolveCorsOrigins();
  app.use(
    cors({
      origin: origins.includes("*") ? true : origins,
      credentials: true,
      exposedHeaders: ["X-Has-More", "X-Next-Offset"],
    }),
  );

  app.use(express.json());

  // Mounted under /api because the frontend is served separately by its own nginx container,
  // which reverse-proxies /api/* here unmodified (see frontend/nginx.conf).
  app.use("/api", healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", settingsRoutes);
  app.use("/api", printsRoutes);
  app.use("/api", authorsRoutes);
  app.use("/api", platesRoutes);
  app.use("/api", previewImagesRoutes);
  app.use("/api", categoriesRoutes);
  app.use("/api", printFilesRoutes);
  app.use("/api", tagsRoutes);
  app.use("/api", importsRoutes);
  app.use("/api", collectionsRoutes);
  app.use("/api", bookmarksRoutes);
  app.use("/api", notificationsRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", dashboardRoutes);

  // 404 fallback for unmatched routes.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ detail: "Not found" });
  });

  // Central error handler: HttpError carries its own status, everything else is a 500.
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
