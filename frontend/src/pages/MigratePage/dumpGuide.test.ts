import { describe, expect, it } from "vitest";
import { DEFAULT_NAMES, guessHost, guideCommands, guidePaths, shellWord } from "./dumpGuide";

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
    expect(commands.bring).toBe("rsync -a thingport.dump old-storage '192.168.1.20:/srv/old library/'");
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
