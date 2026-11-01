import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionRefusedError, providersApi, type ProviderState } from "../api/providers";
import { UnauthorizedError } from "../api/client";
import { settleRetiredSettings } from "./settings";

const OLD_COPY = '{"makerworld":{"cookie":"token=secret"}}';
let stored: Map<string, string>;

function makerworldIs(status: "connected" | "expired" | "disconnected") {
  const state = { id: "makerworld", enabled: true, slots: { default: { status, account: null } } } as ProviderState;
  vi.spyOn(providersApi, "list").mockResolvedValue([state]);
  return vi.spyOn(providersApi, "saveConnection").mockResolvedValue();
}

const yes = () => Promise.resolve(true);

beforeEach(() => {
  stored = new Map([
    ["thingport_settings", OLD_COPY],
    ["thingport_auth_token", "kept"],
  ]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      removeItem: (key: string) => stored.delete(key),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settleRetiredSettings", () => {
  it("hands the old copy over once the person says it's theirs, then forgets it", async () => {
    const save = makerworldIs("disconnected");
    const isTheirs = vi.fn<() => Promise<boolean | null>>(yes);
    await settleRetiredSettings(isTheirs);
    expect(isTheirs).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("makerworld", "default", { cookie: "token=secret" });
    expect([...stored.keys()]).toEqual(["thingport_auth_token"]);
  });

  it("never files it under an account whose person says it isn't theirs, and forgets it", async () => {
    const save = makerworldIs("disconnected");
    await settleRetiredSettings(() => Promise.resolve(false));
    expect(save).not.toHaveBeenCalled();
    expect(stored.has("thingport_settings")).toBe(false);
  });

  it("saves nothing, and keeps it to ask again, when another account signed in while the question was open", async () => {
    const save = makerworldIs("disconnected");
    stored.set("thingport_auth_user", JSON.stringify({ id: "a" }));
    await settleRetiredSettings(() => {
      stored.set("thingport_auth_user", JSON.stringify({ id: "b" }));
      return Promise.resolve(true);
    });
    expect(save).not.toHaveBeenCalled();
    expect(stored.get("thingport_settings")).toBe(OLD_COPY);
  });

  it("keeps it, to ask again, when the question is dismissed without an answer", async () => {
    const save = makerworldIs("disconnected");
    await settleRetiredSettings(() => Promise.resolve(null));
    expect(save).not.toHaveBeenCalled();
    expect(stored.get("thingport_settings")).toBe(OLD_COPY);
  });

  it("doesn't ask, or overwrite, when the account already has a sign-in", async () => {
    const save = makerworldIs("connected");
    const isTheirs = vi.fn<() => Promise<boolean | null>>(yes);
    await settleRetiredSettings(isTheirs);
    expect(isTheirs).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect([...stored.keys()]).toEqual(["thingport_auth_token"]);
  });

  it("forgets a copy the server turned down, as it would only be turned down again", async () => {
    makerworldIs("disconnected").mockRejectedValue(new ConnectionRefusedError("This cookie doesn't work"));
    await settleRetiredSettings(yes);
    expect(stored.has("thingport_settings")).toBe(false);
  });

  it.each([
    ["the server can't be reached", new TypeError("Failed to fetch")],
    ["the session has ended", new UnauthorizedError()],
    ["the server fails", new Error("Failed to load providers")],
  ])("keeps it for the next visit when %s", async (_name, failure) => {
    vi.spyOn(providersApi, "list").mockRejectedValue(failure);
    await settleRetiredSettings(yes);
    expect(stored.get("thingport_settings")).toBe(OLD_COPY);
  });

  it("keeps it when saving fails without the server having judged it", async () => {
    makerworldIs("disconnected").mockRejectedValue(new Error("Failed to update the connection"));
    await settleRetiredSettings(yes);
    expect(stored.get("thingport_settings")).toBe(OLD_COPY);
  });

  it("asks once, however many times it's called while waiting for the answer", async () => {
    makerworldIs("disconnected");
    let answer = (_value: boolean) => {};
    const isTheirs = vi.fn<() => Promise<boolean | null>>(() => new Promise((resolve) => (answer = resolve)));
    const first = settleRetiredSettings(isTheirs);
    await vi.waitFor(() => expect(isTheirs).toHaveBeenCalled());
    await settleRetiredSettings(isTheirs);
    answer(false);
    await first;
    expect(isTheirs).toHaveBeenCalledOnce();
  });

  it("asks nothing when there's no copy, and survives a broken one", async () => {
    const list = vi.spyOn(providersApi, "list");
    stored.delete("thingport_settings");
    await settleRetiredSettings(yes);
    stored.set("thingport_settings", "{not json");
    await settleRetiredSettings(yes);
    expect(list).not.toHaveBeenCalled();
    expect(stored.has("thingport_settings")).toBe(false);
  });

  it("doesn't throw where storage is blocked", async () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    await expect(settleRetiredSettings(yes)).resolves.toBeUndefined();
  });
});

describe("providersApi.saveConnection", () => {
  const answering = (status: number) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "No" }), { status })),
    );
  const save = () => providersApi.saveConnection("makerworld", "default", { cookie: "c" });

  it("takes only a 422 as the server turning the credential down", async () => {
    answering(422);
    await expect(save()).rejects.toBeInstanceOf(ConnectionRefusedError);
  });

  it.each([400, 403, 404, 429, 502, 503])("doesn't take a %i for that", async (status) => {
    answering(status);
    const failure = await save().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ConnectionRefusedError);
  });
});
