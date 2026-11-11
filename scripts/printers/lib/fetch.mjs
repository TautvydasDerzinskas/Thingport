// Each source's profile folders at its pinned release, as a shallow sparse checkout in a cache outside the repo: the
// slicers' repos are hundreds of MB, their profiles a fraction of that. A checkout already at the ref is reused.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The source's checkout, fetched if needed: { dir, commit, date }. */
export function checkout(source, cacheDir) {
  const dir = path.join(cacheDir, source.id);
  const marker = path.join(dir, ".thingport-ref");
  const wanted = JSON.stringify({ repo: source.repo, ref: source.ref, paths: source.paths });
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== wanted) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(cacheDir, { recursive: true });
    const url = `https://github.com/${source.repo}.git`;
    execFileSync(
      "git",
      [
        ...["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", source.ref],
        ...["--filter=blob:none", "--sparse", url, dir],
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    git(dir, "sparse-checkout", "set", ...source.paths);
    writeFileSync(marker, wanted);
  }
  return { dir, commit: git(dir, "rev-parse", "HEAD"), date: git(dir, "log", "-1", "--format=%cI") };
}
