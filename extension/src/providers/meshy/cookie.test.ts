import { describe, expect, it } from "vitest";
import { meshyChunkIndex, meshySessionOf } from "./cookie";

const session = { access_token: "eyJ.a.b", expires_at: 4102444800, user: { id: "u-1", name: "Deržinskas" } };

describe("Meshy's sign-in cookie", () => {
  it("reads the base64 form Supabase writes now, its text kept as UTF-8", () => {
    const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    expect(meshySessionOf(value)).toEqual(session);
  });

  it("reads the percent-encoded JSON older Supabase clients wrote", () => {
    expect(meshySessionOf(encodeURIComponent(JSON.stringify(session)))).toEqual(session);
  });

  it("takes nothing that isn't a session", () => {
    expect(meshySessionOf("base64-!!!")).toBeNull();
    expect(meshySessionOf("not-json")).toBeNull();
    expect(meshySessionOf(encodeURIComponent("[1,2]"))).toBeNull();
  });

  it("orders split chunks by their number, an unsplit cookie first", () => {
    const names = ["sb-auth-auth-token.1", "sb-auth-auth-token", "sb-auth-auth-token.10", "sb-auth-auth-token.0"];
    expect(names.toSorted((a, b) => meshyChunkIndex(a) - meshyChunkIndex(b))).toEqual([
      "sb-auth-auth-token",
      "sb-auth-auth-token.0",
      "sb-auth-auth-token.1",
      "sb-auth-auth-token.10",
    ]);
  });
});
