import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

function normalizeHostEntry(entry) {
  try {
    const parsed = new URL(entry);
    return parsed.hostname;
  } catch {
    return entry.split(":")[0]; // handle host:port input
  }
}

function parseAllowedHosts(value, extras = []) {
  const extraHosts = extras.map(normalizeHostEntry).filter(Boolean);

  if (!value) {
    // Permissive by default for container/reverse-proxy setups; lock down with VITE_ALLOWED_HOSTS.
    return true;
  }

  const normalized = value
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
    .map(normalizeHostEntry);

  const merged = Array.from(new Set([...normalized, ...extraHosts]));

  if (!merged.length) return true;

  if (merged.length === 1 && ["*", "true", "1"].includes(merged[0].toLowerCase())) {
    return true;
  }

  return merged;
}

const resolvedAllowedHosts = parseAllowedHosts(
  process.env.VITE_ALLOWED_HOSTS || process.env.ALLOWED_HOSTS || process.env.CORS_ORIGINS,
);

// The version semantic-release last gave the frontend, shown in Administration > Update Checker.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
  },
  server: {
    host: true,
    allowedHosts: resolvedAllowedHosts,
    proxy: {
      // Mirrors the Docker image's nginx proxy.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    allowedHosts: resolvedAllowedHosts,
  },
  build: {
    // The OpenSCAD libraries are mounted into the engine's filesystem by name, so they stay real files: left to
    // the default, the few under 4 kB get inlined as data: URIs inside JS chunks instead, which still works but
    // turns three of BOSL2's files -- std.scad among them -- into something quite different from the rest.
    assetsInlineLimit: (filePath) => (filePath.endsWith(".scad") ? false : undefined),
  },
  test: {
    // Serves the `?url` assets a test asks for, which in the browser the dev server would answer.
    setupFiles: ["./test/setup.ts"],
  },
});
