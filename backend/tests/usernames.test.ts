import { describe, expect, it } from "vitest";
import { asksIn } from "../src/federation/peers";
import { originsFor, parseHandle } from "../src/federation/userRequests";
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
  });

  it("finds an instance by any address a handle could have guessed for it, ports by its own scheme", () => {
    // Guessed as HTTPS on port 80: still the plain HTTP instance on its default port.
    expect(originsFor("http://things.example")).toContain(parseHandle("bob@things.example:80").origin);
    expect(originsFor("http://things.example")).toContain(parseHandle("bob@things.example").origin);
    expect(originsFor("https://things.example")).toContain(parseHandle("bob@things.example:443").origin);
    // :443 on a plain HTTP instance is a port of its own: an address on port 80 isn't it.
    expect(originsFor("http://things.example:443")).toContain(parseHandle("bob@things.example:443").origin);
    expect(originsFor("http://printer.local:443")).not.toContain(parseHandle("bob@printer.local").origin);
    expect(originsFor("http://192.168.1.30:8000")).toEqual(["http://192.168.1.30:8000", "https://192.168.1.30:8000"]);
    expect(originsFor("http://192.168.1.30:8000")).not.toContain(parseHandle("bob@192.168.1.30").origin);
    expect(originsFor("http://[fd00::5]:8080")).toContain(parseHandle("bob@[fd00::5]:8080").origin);
    expect(parseHandle("bob@nas:8000").origin).toBe("http://nas:8000");
    expect(parseHandle("Bob@Prints.Example").host).toBe("prints.example");
    // As a URL has it: the default port is no port.
    expect(parseHandle("bob@prints.example:443")).toMatchObject({
      host: "prints.example",
      origin: "https://prints.example",
    });
  });

  it("refuse what isn't one", () => {
    for (const bad of [
      "bob",
      "bob@",
      "@prints.example",
      "bob@prints.example:99999",
      "bob@exa mple.com",
      "b b@x.y",
      "bob@[:::]",
      "bob@[1.2.3.4]",
    ]) {
      expect(() => parseHandle(bad)).toThrow(/handle/);
    }
  });
});

describe("who asked whom, as a request names them", () => {
  const from = "http://a.example:8000";
  const mention = (name: string, href?: string) => ({ type: "Mention", name, ...(href ? { href } : {}) });

  it("pairs each person asking with whom they asked for", () => {
    const asks = asksIn(
      {
        tag: [
          mention("@sam@a.example:8000", `${from}/api/ap/actors/u1`),
          mention("@bob@b.example"),
          mention("@tom@a.example:8000", `${from}/api/ap/actors/u2`),
          mention("@bea@b.example"),
        ],
      },
      from,
    );
    expect(asks).toEqual([
      {
        requesterHandle: "sam@a.example:8000",
        requesterUrl: `${from}/api/ap/actors/u1`,
        targetHandle: "bob@b.example",
      },
      {
        requesterHandle: "tom@a.example:8000",
        requesterUrl: `${from}/api/ap/actors/u2`,
        targetHandle: "bea@b.example",
      },
    ]);
  });

  it("takes a lone Mention, and no one on another instance as the one asking", () => {
    expect(asksIn({ tag: mention("@sam", `${from}/api/ap/actors/u1`) }, from)).toHaveLength(1);
    expect(asksIn({ tag: [mention("@eve", "http://elsewhere.example/actors/e"), mention("@bob")] }, from)).toEqual([]);
  });
});
