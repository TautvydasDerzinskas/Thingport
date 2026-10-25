// Builds the extension for one or more browsers into dist/<browser>/, ready to load unpacked or zip
// for a store (scripts/zip.ts).
//
//   tsx scripts/build.ts chrome firefox edge
//   tsx scripts/build.ts chrome --watch        (rebuilds on change; reload the extension to pick it up)

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import * as sass from "sass";
import { TARGETS, buildManifest, isTarget, type Target } from "./manifest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

function compileScss(file: string): { css: string; watchFiles: string[] } {
  const result = sass.compile(file, { style: "compressed" });
  return {
    css: result.css,
    watchFiles: result.loadedUrls.filter((u) => u.protocol === "file:").map((u) => fileURLToPath(u)),
  };
}

/** `?inline` imports compile to a CSS string (for the shadow root); plain imports emit a CSS file. */
const scssPlugin: esbuild.Plugin = {
  name: "scss",
  setup(build) {
    // Relative paths: esbuild writes them into the bundle, and absolute ones would leak the build
    // machine's layout and break reproducible store builds.
    build.onResolve({ filter: /\.scss(\?inline)?$/ }, (args) => {
      const inline = args.path.endsWith("?inline");
      const file = path.resolve(args.resolveDir, args.path.replace(/\?inline$/, ""));
      return { path: path.relative(ROOT, file).split(path.sep).join("/"), namespace: inline ? "scss-inline" : "scss" };
    });
    build.onLoad({ filter: /.*/, namespace: "scss-inline" }, (args) => {
      const { css, watchFiles } = compileScss(path.join(ROOT, args.path));
      return { contents: css, loader: "text", watchFiles };
    });
    build.onLoad({ filter: /.*/, namespace: "scss" }, (args) => {
      const file = path.join(ROOT, args.path);
      const { css, watchFiles } = compileScss(file);
      return { contents: css, loader: "css", resolveDir: path.dirname(file), watchFiles };
    });
  },
};

/** `?worker` imports compile to that file's bundled source as a string, for a blob: URL worker (a
 *  content script can't start one from an extension URL). */
const workerPlugin: esbuild.Plugin = {
  name: "worker",
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, (args) => {
      const file = path.resolve(args.resolveDir, `${args.path.replace(/\?worker$/, "")}.ts`);
      return { path: path.relative(ROOT, file).split(path.sep).join("/"), namespace: "worker" };
    });
    build.onLoad({ filter: /.*/, namespace: "worker" }, async (args) => {
      const result = await esbuild.build({
        entryPoints: [path.join(ROOT, args.path)],
        absWorkingDir: ROOT,
        bundle: true,
        write: false,
        metafile: true,
        format: "iife",
        target: build.initialOptions.target,
        minify: false,
        legalComments: "none",
      });
      return {
        contents: result.outputFiles[0].text,
        loader: "text",
        watchFiles: Object.keys(result.metafile.inputs).map((input) => path.join(ROOT, input)),
      };
    });
  },
};

function staticFilesPlugin(
  target: Target,
  outdir: string,
  pkg: { version: string; description: string },
): esbuild.Plugin {
  return {
    name: "static-files",
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length) return;
        await cp(path.join(ROOT, "public"), outdir, { recursive: true });
        await cp(path.join(SRC, "popup", "popup.html"), path.join(outdir, "popup.html"));
        await writeFile(path.join(outdir, "manifest.json"), `${JSON.stringify(buildManifest(target, pkg), null, 2)}\n`);
      });
    },
  };
}

async function buildTarget(target: Target, watch: boolean): Promise<void> {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as {
    version: string;
    description: string;
  };
  const outdir = path.join(ROOT, "dist", target);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const options: esbuild.BuildOptions = {
    entryPoints: {
      background: path.join(SRC, "background", "index.ts"),
      content: path.join(SRC, "content", "index.ts"),
      popup: path.join(SRC, "popup", "index.ts"),
      thingiverse: path.join(SRC, "providers", "thingiverse", "index.ts"),
    },
    outdir,
    bundle: true,
    // Content scripts can't be modules, and one format keeps Chrome's and Firefox's background identical.
    format: "iife",
    target: ["chrome110", "firefox115"],
    // Store reviewers (AMO in particular) read the submitted code.
    minify: false,
    sourcemap: watch ? "inline" : false,
    legalComments: "none",
    loader: { ".svg": "text" },
    plugins: [scssPlugin, workerPlugin, staticFilesPlugin(target, outdir, pkg)],
    logLevel: "info",
  };

  if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
    console.log(`[${target}] watching -- load dist/${target} as an unpacked extension`);
    return;
  }
  await esbuild.build(options);
  console.log(`[${target}] built dist/${target} (v${pkg.version})`);
}

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const requested = args.filter((arg) => !arg.startsWith("--"));
const unknown = requested.filter((arg) => !isTarget(arg));
if (unknown.length) {
  console.error(`Unknown target(s): ${unknown.join(", ")}. Expected: ${TARGETS.join(", ")}`);
  process.exit(1);
}
const targets = (requested.length ? requested : [...TARGETS]) as Target[];
for (const target of targets) await buildTarget(target, watch);
