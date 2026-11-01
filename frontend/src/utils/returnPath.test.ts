import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberReturnPath, takeReturnPath } from "./returnPath";

function signedOutAt(pathname: string, search = "") {
  const stored = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { pathname, search },
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
}

const afterSignIn = (pathname: string, search = "") => {
  signedOutAt(pathname, search);
  rememberReturnPath();
  return takeReturnPath();
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the return path", () => {
  it("brings back a link into the import queue, with or without its section", () => {
    expect(afterSignIn("/admin-queue")).toBe("/admin-queue");
    expect(afterSignIn("/import-queue")).toBe("/import-queue");
    expect(afterSignIn("/admin-queue", "?import-queue=att")).toBe("/admin-queue?import-queue=att");
    expect(afterSignIn("/import-queue", "?import-queue=wait")).toBe("/import-queue?import-queue=wait");
  });

  it("still brings back Grab's approval and the bookmarklet's link, which need their query", () => {
    expect(afterSignIn("/connect-grab", "?state=x")).toBe("/connect-grab?state=x");
    expect(afterSignIn("/import", "?url=https%3A%2F%2Fexample.com")).toBe("/import?url=https%3A%2F%2Fexample.com");
    expect(afterSignIn("/connect-grab")).toBeNull();
    expect(afterSignIn("/import")).toBeNull();
  });

  it("forgets anything else", () => {
    expect(afterSignIn("/models", "?category=1")).toBeNull();
    expect(afterSignIn("/admin-queues")).toBeNull();
  });

  it("gives it once", () => {
    signedOutAt("/admin-queue");
    rememberReturnPath();
    expect(takeReturnPath()).toBe("/admin-queue");
    expect(takeReturnPath()).toBeNull();
  });
});
