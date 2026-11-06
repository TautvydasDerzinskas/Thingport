import { afterEach, describe, expect, it } from "vitest";
import { classifyHost, classifyIp, isLocalName, originOf } from "../src/federation/addresses";

describe("classifyIp", () => {
  afterEach(() => {
    delete process.env.FEDERATION_ALLOW_LOOPBACK;
  });

  it.each([
    ["192.168.1.181", "local"],
    ["10.1.2.3", "local"],
    ["172.20.0.5", "local"],
    ["100.100.1.1", "local"], // Tailscale
    ["fd12::1", "local"],
    ["8.8.8.8", "public"],
    ["198.51.100.7", "public"],
    ["2606:4700::1111", "public"],
    ["127.0.0.1", "never"],
    ["0.0.0.0", "never"],
    ["169.254.169.254", "never"], // cloud metadata
    ["198.18.0.1", "never"],
    ["224.0.0.1", "never"],
    ["::1", "never"],
    ["fe80::1", "never"],
    ["::ffff:127.0.0.1", "never"],
    ["::ffff:192.168.1.5", "never"],
    ["64:ff9b::7f00:1", "never"],
    ["2002:7f00:1::1", "never"],
    ["4000::1", "never"],
    ["not an address", "never"],
  ])("%s is %s", (address, kind) => {
    expect(classifyIp(address)).toBe(kind);
  });

  // A BlockList matches IPv4 against IPv6 rules in their IPv4-mapped form: the ::ffff:0:0/96 rule must not catch
  // every IPv4 address.
  it("keeps IPv6 rules away from IPv4 addresses", () => {
    expect(classifyIp("192.168.0.1")).toBe("local");
    expect(classifyIp("1.1.1.1")).toBe("public");
  });

  it("treats this machine as local only when tests ask for it", () => {
    process.env.FEDERATION_ALLOW_LOOPBACK = "1";
    expect(classifyIp("127.0.0.1")).toBe("local");
    expect(classifyIp("::1")).toBe("local");
    expect(classifyIp("169.254.169.254")).toBe("never");
  });
});

describe("isLocalName", () => {
  it.each([
    ["thingport.lan", true],
    ["nas.local", true],
    ["printer.home.arpa", true],
    ["box.internal", true],
    ["nas", true],
    ["things.example.org", false],
    ["localhost", false],
  ])("%s → %s", (host, local) => {
    expect(isLocalName(host)).toBe(local);
  });
});

describe("classifyHost", () => {
  const resolves =
    (...addresses: string[]) =>
    async () =>
      addresses.map((address) => ({ address }));

  it("is public when any address is", async () => {
    expect(await classifyHost("things.example.org", resolves("203.0.113.5", "10.0.0.2"))).toEqual({
      kind: "public",
      addresses: ["203.0.113.5", "10.0.0.2"],
    });
  });

  it("is local when every address is on a private network", async () => {
    expect((await classifyHost("nas.example.org", resolves("192.168.1.30"))).kind).toBe("local");
  });

  it("refuses a name with one address it must never reach", async () => {
    expect((await classifyHost("sneaky.example.org", resolves("203.0.113.5", "127.0.0.1"))).kind).toBe("never");
  });

  it("calls a local-only name local even on a public address", async () => {
    expect((await classifyHost("thingport.lan", resolves("203.0.113.5"))).kind).toBe("local");
  });

  it("doesn't look up an address written as one", async () => {
    const lookup = async () => {
      throw new Error("looked up");
    };
    expect((await classifyHost("192.168.1.30", lookup)).kind).toBe("local");
    expect((await classifyHost("[::1]", lookup)).kind).toBe("never");
  });

  it("refuses a name that resolves to nothing", async () => {
    expect((await classifyHost("empty.example.org", resolves())).kind).toBe("never");
  });
});

describe("originOf", () => {
  it.each([
    ["http://192.168.1.30:8000/api/ap/actors/instance", "http://192.168.1.30:8000"],
    ["https://things.example.org/x#main-key", "https://things.example.org"],
    ["ftp://things.example.org/", null],
    ["https://user:pass@things.example.org/", null],
    ["not a url", null],
  ])("%s → %s", (value, origin) => {
    expect(originOf(value)).toBe(origin);
  });
});
