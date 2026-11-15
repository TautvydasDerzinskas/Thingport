import type { MigrateOwner } from "../../api/migrate";

/** What the dump guide's commands are made from: the old instance's Postgres names and storage path in its backend,
 *  and this server's address and folder the two go to. */
export type GuideNames = { user: string; database: string; storage: string; host: string; folder: string };

/** What a field left empty stands for. The address's is a placeholder, plain enough to see it needs changing. */
export const DEFAULT_NAMES: GuideNames = {
  user: "thingport",
  database: "thingport",
  storage: "/app/storage",
  host: "this-server",
  folder: "/srv/old-thingport",
};

/** Who the folder goes to when the backend can't say: PUID and PGID's defaults. */
const DEFAULT_OWNER: MigrateOwner = { uid: 1000, gid: 1000 };

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

/** Whether the rsync line needs -s for this folder: rsync before 3.2.4 hands the path to the far server's shell, which
 *  splits it again. -s takes rsync 3.0 or later on both servers, and macOS's own rsync has none, so only then. */
export function folderNeedsProtect(value: string): boolean {
  const folder = value.trim();
  return Boolean(folder) && shellWord(folder) !== folder;
}

/** The address as each command takes it. rsync splits `host:path` at the first colon, so an IPv6 address goes in
 *  brackets, which it takes off again; ssh looks the name up as given, brackets and all, so there it goes without. */
export function hostForms(value: string): { rsync: string; ssh: string } {
  const at = value.lastIndexOf("@");
  const user = value.slice(0, at + 1);
  const name = value.slice(at + 1).replace(/^\[(.*)\]$/, "$1");
  const ipv6 = (name.match(/:/g) ?? []).length > 1;
  return { rsync: user + (ipv6 ? `[${name}]` : name), ssh: user + name };
}

/** The commands for each step, with the names given, or their defaults where a field is left empty. `root` is where
 *  this server's backend reads a migration from, `owner` who it runs as, `comment` the Compose file's note that its
 *  other volumes stay. */
export function guideCommands(
  given: GuideNames,
  { root, owner, comment }: { root: string; owner: MigrateOwner | null; comment: string },
) {
  const pick = (key: keyof GuideNames) => given[key].trim() || DEFAULT_NAMES[key];
  const folder = pick("folder").replace(/\/+$/, "") || DEFAULT_NAMES.folder;
  const storage = pick("storage").replace(/\/+$/, "") || DEFAULT_NAMES.storage;
  const { uid, gid } = owner ?? DEFAULT_OWNER;
  const protect = folderNeedsProtect(folder) ? "s" : "";
  const host = hostForms(pick("host"));
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
    // The dump holds password hashes and provider sign-ins, so it's made readable by its owner only, and rsync -a
    // keeps that; the parentheses keep the umask to this one command.
    dump: [
      "docker compose stop backend",
      `(umask 077 && docker compose exec -T db pg_dump -U ${shellWord(pick("user"))} -Fc ${shellWord(pick("database"))} > ${DUMP})`,
    ].join("\n"),
    // compose cp reads the stopped backend, its mounts included, so a bind folder and a volume copy alike, and
    // leaves out containers a `docker compose run` left behind.
    storage: `docker compose cp ${shellWord(`backend:${storage}/.`)} ${STORAGE}`,
    // rsync makes only the last folder of the path, so the rest is made first, for its owner only. ssh hands its
    // command to the far server's shell, hence the folder quoted twice.
    bring: [
      `ssh ${shellWord(host.ssh)} mkdir -p -m 700 ${shellWord(shellWord(folder))}`,
      `rsync -a${protect} ${DUMP} ${STORAGE} ${shellWord(`${host.rsync}:${folder}/`)}`,
    ].join("\n"),
    // Whoever copied them, the backend's user then owns them, and only it can read the dump.
    hand: `sudo chown -R ${uid}:${gid} ${shellWord(folder)}`,
    mount: ["services:", "  backend:", "    volumes:", `      # ${comment}`, ...volume].join("\n"),
    restart: "docker compose up -d backend",
  };
}

/** Where the Source step finds the two once they're mounted. */
export function guidePaths(root: string): { dumpPath: string; folder: string } {
  const base = root.replace(/\/+$/, "");
  return { dumpPath: `${base}/${DUMP}`, folder: `${base}/${STORAGE}` };
}
