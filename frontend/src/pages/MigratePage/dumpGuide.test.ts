import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAMES,
  composeValue,
  folderIsAbsolute,
  folderNeedsProtect,
  guessHost,
  hostForms,
  guideCommands,
  guidePaths,
  shellWord,
} from "./dumpGuide";

const where = { root: "/app/migrate", owner: null, comment: "...its own volumes, as they are..." };

describe("dump guide", () => {
  it("fills the commands in from the names given", () => {
    const commands = guideCommands(
      { user: "tp", database: "library", storage: "/data/storage/", host: "192.168.1.20", folder: "/data/old/" },
      { ...where, owner: { uid: 99, gid: 100 } },
    );
    expect(commands.dump).toBe(
      "docker compose stop backend\n" +
        "touch thingport.dump && chmod 600 thingport.dump && " +
        "docker compose exec -T db pg_dump -U tp -Fc library > thingport.dump",
    );
    // Stopped by an earlier try's copy, which it would add to.
    expect(commands.storage).toBe("mkdir -m 700 old-storage && docker compose cp backend:/data/storage/. old-storage");
    // With sudo only where the SSH user can't make the folder, as under /srv, and then only a new one; 755 either way.
    expect(commands.bring).toBe(
      "ssh -t 192.168.1.20 'mkdir -p -m 755 /data/old 2>/dev/null || " +
        `{ umask 022; sudo mkdir -p /data && sudo mkdir -m 755 /data/old && sudo chown "$(id -u)" /data/old; }'\n` +
        "rsync -a --delete thingport.dump old-storage 192.168.1.20:/data/old/",
    );
    // The two only: the folder may hold other things, so it's left as it is.
    expect(commands.hand).toBe("sudo chown -R 99:100 /data/old/thingport.dump /data/old/old-storage");
    expect(commands.mount).toContain("      - /data/old:/app/migrate:ro");
    expect(commands.mount).toContain("      # ...its own volumes, as they are...");
  });

  it("takes the defaults for a field left empty", () => {
    const commands = guideCommands({ user: " ", database: "", storage: "", host: "", folder: "" }, where);
    expect(commands.dump).toContain(`-U ${DEFAULT_NAMES.user} -Fc ${DEFAULT_NAMES.database} >`);
    expect(commands.storage).toBe("mkdir -m 700 old-storage && docker compose cp backend:/app/storage/. old-storage");
    expect(commands.bring.split("\n").at(-1)).toBe(
      `rsync -a --delete thingport.dump old-storage this-server:${DEFAULT_NAMES.folder}/`,
    );
    // The backend couldn't say who it runs as: PUID and PGID's defaults.
    expect(commands.hand).toBe(
      `sudo chown -R 1000:1000 ${DEFAULT_NAMES.folder}/thingport.dump ${DEFAULT_NAMES.folder}/old-storage`,
    );
  });

  it("quotes what the shell would read as more than a name", () => {
    expect(shellWord("thingport")).toBe("thingport");
    expect(shellWord("my user")).toBe("'my user'");
    expect(shellWord("it's")).toBe("'it'\\''s'");
    expect(shellWord("$(reboot)")).toBe("'$(reboot)'");
    const commands = guideCommands(
      { user: "a b", database: "x;y", storage: "/data/my storage", host: "192.168.1.20", folder: "/srv/old library" },
      where,
    );
    expect(commands.dump).toContain("-U 'a b' -Fc 'x;y' >");
    expect(commands.storage).toBe(
      "mkdir -m 700 old-storage && docker compose cp 'backend:/data/my storage/.' old-storage",
    );
    // Quoted twice for ssh, whose far shell reads the command again; -s, or an older rsync's far shell splits it.
    expect(commands.bring).toBe(
      "ssh -t 192.168.1.20 'mkdir -p -m 755 '\\''/srv/old library'\\'' 2>/dev/null || " +
        "{ umask 022; sudo mkdir -p /srv && sudo mkdir -m 755 '\\''/srv/old library'\\'' && " +
        `sudo chown "$(id -u)" '\\''/srv/old library'\\''; }'\n` +
        "rsync -as --delete thingport.dump old-storage '192.168.1.20:/srv/old library/'",
    );
    expect(commands.hand).toBe(
      "sudo chown -R 1000:1000 '/srv/old library/thingport.dump' '/srv/old library/old-storage'",
    );
  });

  it("brackets an IPv6 address for rsync but not for ssh", () => {
    expect(hostForms("2001:db8::20")).toEqual({ rsync: "[2001:db8::20]", ssh: "2001:db8::20" });
    expect(hostForms("[2001:db8::20]")).toEqual({ rsync: "[2001:db8::20]", ssh: "2001:db8::20" });
    expect(hostForms("me@2001:db8::20")).toEqual({ rsync: "me@[2001:db8::20]", ssh: "me@2001:db8::20" });
    for (const host of ["192.168.1.20", "me@thingport.lan", "this-server"]) {
      expect(hostForms(host)).toEqual({ rsync: host, ssh: host });
    }
    const { bring } = guideCommands({ ...DEFAULT_NAMES, host: "2001:db8::20" }, where);
    const [ssh, rsync] = bring.split("\n");
    expect(ssh).toMatch(/^ssh -t 2001:db8::20 'mkdir -p -m 755 \/srv\/old-thingport /);
    expect(rsync).toBe("rsync -a --delete thingport.dump old-storage '[2001:db8::20]:/srv/old-thingport/'");
    // A folder right under /, whose parent is / itself.
    expect(guideCommands({ ...DEFAULT_NAMES, folder: "/old" }, where).bring).toContain(
      "{ umask 022; sudo mkdir -p / && ",
    );
    // A nested one: parents sudo makes are 755 too, whatever umask sudo keeps, so the SSH user gets through them.
    expect(guideCommands({ ...DEFAULT_NAMES, folder: "/srv/migrations/old" }, where).bring).toContain(
      "{ umask 022; sudo mkdir -p /srv/migrations && sudo mkdir -m 755 /srv/migrations/old && ",
    );
  });

  it("says when the folder needs -s, which macOS's own rsync lacks", () => {
    for (const folder of ["/srv/old library", " /srv/(old) ", "/srv/it's"]) {
      expect(folderNeedsProtect(folder)).toBe(true);
    }
    for (const folder of ["", " ", "/srv/old-thingport/", "/srv/archive:2026"]) {
      expect(folderNeedsProtect(folder)).toBe(false);
    }
  });

  it("writes the mount so Compose reads the folder as it was given", () => {
    const mount = (folder: string) =>
      guideCommands({ ...DEFAULT_NAMES, folder }, where)
        .mount.split("\n")
        .at(-1);
    expect(mount("/srv/old #1")).toBe('      - "/srv/old #1:/app/migrate:ro"');
    expect(mount("/srv/$backup")).toBe('      - "/srv/$$backup:/app/migrate:ro"');
    expect(composeValue("/srv/old-thingport:/app/migrate:ro")).toBe("/srv/old-thingport:/app/migrate:ro");
    expect(composeValue("/srv/old:")).toBe('"/srv/old:"');
  });

  it("writes a folder with a colon in the long form, as the short one splits on it", () => {
    const { mount } = guideCommands({ ...DEFAULT_NAMES, folder: "/srv/archive:2026" }, where);
    expect(mount.split("\n").slice(-6)).toEqual([
      "      - type: bind",
      "        source: /srv/archive:2026",
      "        target: /app/migrate",
      "        read_only: true",
      "        bind:",
      "          create_host_path: false",
    ]);
  });

  it("takes only an absolute POSIX folder, as Compose mounts a bare name as a volume", () => {
    for (const folder of ["", " ", "/srv/old"]) expect(folderIsAbsolute(folder)).toBe(true);
    // A drive path is no path to the shell commands that bring the files.
    for (const folder of ["old-migration", "./old", "~/old", "C:\\old", "D:/old"]) {
      expect(folderIsAbsolute(folder)).toBe(false);
    }
  });

  it("guesses this server's address from the browser's, but not a loopback one", () => {
    expect(guessHost("192.168.1.20")).toBe("192.168.1.20");
    expect(guessHost("thingport.lan")).toBe("thingport.lan");
    for (const loopback of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "[::1]"]) {
      expect(guessHost(loopback)).toBe("");
    }
  });

  it("gives the Source step the paths the backend sees", () => {
    expect(guidePaths("/app/migrate")).toEqual({
      dumpPath: "/app/migrate/thingport.dump",
      folder: "/app/migrate/old-storage",
    });
    expect(guidePaths("/srv/migrate/").folder).toBe("/srv/migrate/old-storage");
  });
});
