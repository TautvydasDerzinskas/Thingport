import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The folder, under the base path, where the site serves the images its Markdown shows, at their repo paths. */
export const REPO_IMAGES = "repo/";

const CONTENT_TYPES = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// Over twice the width the docs and blog show an image at, so screenshots stay sharp on high-density screens.
const MAX_WIDTH = 1600;

/**
 * Serves the images the docs and blog show (rehypeRepoLinks points them at `repo/<path>`) from the checkout being
 * built, rather than hot-linking GitHub's main branch, which may not have them yet. `astro dev` reads them straight
 * from the repo; the build copies in each one a page shows, and fails if one isn't there.
 * @returns {import("astro").AstroIntegration}
 */
export function repoImages() {
  let prefix = `/${REPO_IMAGES}`;
  return {
    name: "repo-images",
    hooks: {
      "astro:config:setup": ({ config, updateConfig }) => {
        prefix = config.base.replace(/\/?$/, "/") + REPO_IMAGES;
        updateConfig({
          vite: {
            plugins: [
              {
                name: "repo-images",
                apply: "serve",
                configureServer(server) {
                  server.middlewares.use(serve);
                },
              },
            ],
          },
        });
      },
      // Astro caches rendered Markdown, so the plugin may not have run: the built pages say what they show.
      "astro:build:done": async ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        /** @type {Map<string, string>} each image's path under `repo/`, and a page that shows it */
        const shown = new Map();
        for (const page of await readdir(out, { recursive: true })) {
          if (!page.endsWith(".html")) continue;
          const html = await readFile(path.join(out, page), "utf8");
          for (const [, attr, value] of html.matchAll(/\s(src|srcset)="([^"]*)"/g)) {
            for (const url of attr === "srcset" ? value.split(",").map((c) => c.trim().split(/\s/)[0]) : [value]) {
              if (url.startsWith(prefix)) shown.set(url.slice(prefix.length).split(/[?#]/)[0], page);
            }
          }
        }
        const images = await Promise.all(
          [...shown].map(async ([urlPath, page]) => ({ urlPath, page, ...(await repoImage(urlPath)) })),
        );
        const problems = images.filter((image) => !image.file);
        if (problems.length) {
          const list = problems.map(({ urlPath, page, error }) => `\n  ${urlPath} (shown on ${page}): ${error}`);
          throw new Error(`Images the pages show that the repo can't provide:${list.join("")}`);
        }
        const files = new Set(images.map((image) => /** @type {string} */ (image.file)));
        await Promise.all(
          [...files].map(async (file) => {
            const target = path.join(out, REPO_IMAGES, path.relative(REPO_ROOT, file));
            await mkdir(path.dirname(target), { recursive: true });
            await writeImage(file, target);
          }),
        );
        logger.info(`${files.size} images copied from the repo`);
      },
    },
  };
}

/**
 * The image file a path under `repo/` names, or why there isn't one: only image files inside the repo are served.
 * @param {string} urlPath
 * @returns {Promise<{ file?: string, error?: string }>}
 */
async function repoImage(urlPath) {
  let file;
  try {
    file = path.resolve(REPO_ROOT, decodeURIComponent(urlPath));
  } catch {
    return { error: "not a valid URL path" };
  }
  if (!file.startsWith(REPO_ROOT)) return { error: "outside the repo" };
  if (!(path.extname(file).toLowerCase() in CONTENT_TYPES)) return { error: "not an image" };
  const stats = await stat(file).catch(() => null);
  return stats?.isFile() ? { file } : { error: "no such file in the repo" };
}

/**
 * The dev server's `repo/`. Astro's own middleware has taken the base path off the URL by the time this runs.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {(error?: unknown) => void} next
 */
async function serve(req, res, next) {
  const pathname = req.url?.split(/[?#]/)[0] ?? "";
  if (!pathname.startsWith(`/${REPO_IMAGES}`) || (req.method !== "GET" && req.method !== "HEAD")) return next();
  const { file, error } = await repoImage(pathname.slice(REPO_IMAGES.length + 1));
  if (!file) {
    res.statusCode = 404;
    return res.end(error);
  }
  res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file).toLowerCase()]);
  res.setHeader("Cache-Control", "no-cache");
  if (req.method === "HEAD") return res.end();
  createReadStream(file).on("error", next).pipe(res);
}

/**
 * Copies an image into the build. A PNG or JPEG wider than MAX_WIDTH is scaled down to it, keeping its format since
 * the page's URL names the file: a PNG as a 256-colour palette, a fraction of a screenshot's size.
 * @param {string} file
 * @param {string} target
 */
async function writeImage(file, target) {
  const type = path.extname(file).toLowerCase();
  if (type === ".png" || type === ".jpg" || type === ".jpeg") {
    const { default: sharp } = await import("sharp");
    const image = sharp(file);
    if (((await image.metadata()).width ?? 0) > MAX_WIDTH) {
      image.resize({ width: MAX_WIDTH });
      if (type === ".png") image.png({ palette: true });
      else image.jpeg({ quality: 80, mozjpeg: true });
      await image.toFile(target);
      return;
    }
  }
  await copyFile(file, target);
}
