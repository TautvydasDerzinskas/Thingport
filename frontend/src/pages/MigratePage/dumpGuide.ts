/** What the dump guide's commands are made from: the old instance's Postgres names, and this server's address and
 *  folder the two go to. */
export type GuideNames = { user: string; database: string; host: string; folder: string };

/** What a field left empty stands for. The address's is a placeholder, plain enough to see it needs changing. */
export const DEFAULT_NAMES: GuideNames = {
  user: "thingport",
  database: "thingport",
  host: "this-server",
  folder: "/srv/old-thingport",
};

/** This server's address as the browser reached it, a likely guess at how the old server reaches it, except a loopback
 *  one, which on the old server would mean the old server. */
export function guessHost(hostname: string): string {
  const name = hostname.toLowerCase();
  const loopback =
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.startsWith("127.") ||
    name === "[::1]" ||
    name === "::1";
  return loopback ? "" : hostname;
}

/** The dump and the storage copy, as the commands name them. */
const DUMP = "thingport.dump";
const STORAGE = "old-storage";

/** A word for a POSIX shell: as it is when nothing in it is special, else single-quoted. */
export function shellWord(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A value for a Compose file: `$` doubled, as Compose reads `$NAME` as a variable even in quotes, and double-quoted
 *  unless YAML would read it as a plain string, as ` #` starts a comment and a `:` ending it a key. */
export function composeValue(value: string): string {
  const escaped = value.replace(/\$/g, () => "$$");
  return /^[\w/.][\w@%+=:,./-]*$/.test(escaped) && !escaped.endsWith(":") ? escaped : JSON.stringify(escaped);
}

/** Whether the folder field holds an absolute path, or nothing (the default): Compose mounts a bare name as a named
 *  volume, not a folder. */
export function folderIsAbsolute(value: string): boolean {
  const folder = value.trim();
  return !folder || folder.startsWith("/") || /^[A-Za-z]:[\\/]/.test(folder);
}

/** The commands for each step, with the names given, or their defaults where a field is left empty. `root` is where
 *  this server's backend reads a migration from, `comment` the Compose file's note that its other volumes stay. */
export function guideCommands(given: GuideNames, { root, comment }: { root: string; comment: string }) {
  const pick = (key: keyof GuideNames) => given[key].trim() || DEFAULT_NAMES[key];
  const folder = pick("folder").replace(/\/+$/, "") || DEFAULT_NAMES.folder;
  // rsync before 3.2.4 hands the path to the old server's shell, which splits it again unless -s keeps it whole.
  // macOS's rsync has no -s, so it's there only for a path that needs it.
  const protect = shellWord(folder) === folder ? "" : "s";
  // Compose splits the short form on `:`, so a folder with one past a drive letter is written out in full. It hands
  // the long form on as a short one too while it may create the folder, hence create_host_path off.
  const volume = folder.replace(/^[A-Za-z]:/, "").includes(":")
    ? [
        "      - type: bind",
        `        source: ${composeValue(folder)}`,
        `        target: ${composeValue(root)}`,
        "        read_only: true",
        "        bind:",
        "          create_host_path: false",
      ]
    : [`      - ${composeValue(`${folder}:${root}:ro`)}`];
  return {
    dump: [
      "docker compose stop backend",
      `docker compose exec -T db pg_dump -U ${shellWord(pick("user"))} -Fc ${shellWord(pick("database"))} > ${DUMP}`,
    ].join("\n"),
    // compose cp reads the stopped backend, its mounts included, so a bind folder and a volume copy alike, and
    // leaves out containers a `docker compose run` left behind.
    storage: `docker compose cp backend:/app/storage/. ${STORAGE}`,
    bring: `rsync -a${protect} ${DUMP} ${STORAGE} ${shellWord(`${pick("host")}:${folder}/`)}`,
    mount: ["services:", "  backend:", "    volumes:", `      # ${comment}`, ...volume].join("\n"),
    restart: "docker compose up -d backend",
  };
}

/** Where the Source step finds the two once they're mounted. */
export function guidePaths(root: string): { dumpPath: string; folder: string } {
  const base = root.replace(/\/+$/, "");
  return { dumpPath: `${base}/${DUMP}`, folder: `${base}/${STORAGE}` };
}
