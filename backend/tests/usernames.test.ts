import { describe, expect, it } from "vitest";
import { parseHandle } from "../src/federation/userRequests";
import { checkUsername, usernameFrom } from "../src/services/usernames";

describe("usernames", () => {
  it("are made from a display name, accents folded", () => {
    expect(usernameFrom("Žygimantas Šimkus")).toBe("zygimantas-simkus");
    expect(usernameFrom("Rūta K.")).toBe("ruta-k");
    expect(usernameFrom("Łukasz Ørsted")).toBe("lukasz-orsted");
    expect(usernameFrom("ÄNNE ÇELİK")).toBe("anne-celik");
    expect(usernameFrom("dot.ted_name")).toBe("dot.ted_name");
    expect(usernameFrom("  !!!  ")).toBe("user");
    expect(usernameFrom("a".repeat(40))).toBe("a".repeat(30));
    // Cut at 30, then the dash it ends on dropped.
    expect(usernameFrom(`${"a".repeat(29)} b`)).toBe("a".repeat(29));
  });

  it("are taken as typed in lower case, or refused with why", () => {
    expect(checkUsername("@Alex")).toBe("alex");
    expect(checkUsername(" a ")).toBe("a");
    expect(checkUsername("a.b-c_d")).toBe("a.b-c_d");
    for (const bad of ["", "-alex", "alex.", "al ex", "a".repeat(31), "žemė", "a@b"]) {
      expect(() => checkUsername(bad)).toThrow(/letters, digits/);
    }
  });
});

describe("handles", () => {
  it("give the person and their instance's likely address", () => {
    expect(parseHandle("bob@prints.example")).toEqual({
      username: "bob",
      host: "prints.example",
      origin: "https://prints.example",
    });
    // Plain HTTP on a local network: an address, a .lan or .local name, or a single label.
    expect(parseHandle("@Bob@192.168.1.30:8000")).toMatchObject({
      username: "bob",
      origin: "http://192.168.1.30:8000",
    });
    expect(parseHandle("bob@[FD00::5]:8080").origin).toBe("http://[fd00::5]:8080");
    expect(parseHandle("bob@printer.local").origin).toBe("http://printer.local");
    expect(parseHandle("bob@nas:8000").origin).toBe("http://nas:8000");
    expect(parseHandle("Bob@Prints.Example").host).toBe("prints.example");
  });

  it("refuse what isn't one", () => {
    for (const bad of ["bob", "bob@", "@prints.example", "bob@prints.example:99999", "bob@exa mple.com", "b b@x.y"]) {
      expect(() => parseHandle(bad)).toThrow(/handle/);
    }
  });
});
