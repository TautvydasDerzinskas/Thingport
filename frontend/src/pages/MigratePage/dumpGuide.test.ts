import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAMES,
  composeValue,
  folderIsAbsolute,
  guessHost,
  guideCommands,
  guidePaths,
  shellWord,
} from "./dumpGuide";

const where = { root: "/app/migrate", comment: "...its own volumes, as they are..." };

describe("dump guide", () => {
  it("fills the commands in from the names given", () => {
    const commands = guideCommands(
      { user: "tp", database: "library", host: "192.168.1.20", folder: "/data/old/" },
      where,
    );
    expect(commands.dump).toBe(
      "docker compose stop backend\ndocker compose exec -T db pg_dump -U tp -Fc library > thingport.dump",
    );
    expect(commands.storage).toBe("docker compose cp backend:/app/storage/. old-storage");
    expect(commands.bring).toBe("rsync -a thingport.dump old-storage 192.168.1.20:/data/old/");
    expect(commands.mount).toContain("      - /data/old:/app/migrate:ro");
    expect(commands.mount).toContain("      # ...its own volumes, as they are...");
  });

  it("takes the defaults for a field left empty", () => {
    const commands = guideCommands({ user: " ", database: "", host: "", folder: "" }, where);
    expect(commands.dump).toContain(`-U ${DEFAULT_NAMES.user} -Fc ${DEFAULT_NAMES.database} >`);
    expect(commands.bring).toBe(`rsync -a thingport.dump old-storage this-server:${DEFAULT_NAMES.folder}/`);
  });

  it("quotes what the shell would read as more than a name", () => {
    expect(shellWord("thingport")).toBe("thingport");
    expect(shellWord("my user")).toBe("'my user'");
    expect(shellWord("it's")).toBe("'it'\\''s'");
    expect(shellWord("$(reboot)")).toBe("'$(reboot)'");
    const commands = guideCommands(
      { user: "a b", database: "x;y", host: "192.168.1.20", folder: "/srv/old library" },
      where,
    );
    expect(commands.dump).toContain("-U 'a b' -Fc 'x;y' >");
    // -s, or an older rsync's remote shell splits the path the local one kept whole.
    expect(commands.bring).toBe("rsync -as thingport.dump old-storage '192.168.1.20:/srv/old library/'");
  });

  it("writes the mount so Compose reads the folder as it was given", () => {
    const mount = (folder: string) =>
      guideCommands({ ...DEFAULT_NAMES, folder }, where)
        .mount.split("\n")
        .at(-1);
    expect(mount("/srv/old #1")).toBe('      - "/srv/old #1:/app/migrate:ro"');
    expect(mount("/srv/$backup")).toBe('      - "/srv/$$backup:/app/migrate:ro"');
    expect(mount("C:\\thingport\\old")).toBe('      - "C:\\\\thingport\\\\old:/app/migrate:ro"');
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
    expect(guideCommands({ ...DEFAULT_NAMES, folder: "D:/old" }, where).mount).toContain(
      "      - D:/old:/app/migrate:ro",
    );
  });

  it("takes only an absolute folder, as Compose mounts a bare name as a volume", () => {
    for (const folder of ["", " ", "/srv/old", "C:\\old", "D:/old"]) expect(folderIsAbsolute(folder)).toBe(true);
    for (const folder of ["old-migration", "./old", "~/old"]) expect(folderIsAbsolute(folder)).toBe(false);
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
