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

/** The commands for each step, with the names given, or their defaults where a field is left empty. `root` is where
 *  this server's backend reads a migration from, `comment` the Compose file's note that its other volumes stay. */
export function guideCommands(given: GuideNames, { root, comment }: { root: string; comment: string }) {
  const pick = (key: keyof GuideNames) => given[key].trim() || DEFAULT_NAMES[key];
  const folder = pick("folder").replace(/\/+$/, "") || DEFAULT_NAMES.folder;
  return {
    dump: [
      "docker compose stop backend",
      `docker compose exec -T db pg_dump -U ${shellWord(pick("user"))} -Fc ${shellWord(pick("database"))} > ${DUMP}`,
    ].join("\n"),
    // docker cp reads a stopped container, its mounts included, so a bind folder and a volume copy alike.
    storage: `docker cp "$(docker compose ps -aq backend)":/app/storage/. ${STORAGE}`,
    bring: `rsync -a ${DUMP} ${STORAGE} ${shellWord(`${pick("host")}:${folder}/`)}`,
    mount: ["services:", "  backend:", "    volumes:", `      # ${comment}`, `      - ${folder}:${root}:ro`].join("\n"),
    restart: "docker compose up -d backend",
  };
}

/** Where the Source step finds the two once they're mounted. */
export function guidePaths(root: string): { dumpPath: string; folder: string } {
  const base = root.replace(/\/+$/, "");
  return { dumpPath: `${base}/${DUMP}`, folder: `${base}/${STORAGE}` };
}
