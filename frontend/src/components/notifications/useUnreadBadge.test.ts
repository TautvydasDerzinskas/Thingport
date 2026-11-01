import { describe, expect, it } from "vitest";
import { faviconBadgeLabel } from "./useUnreadBadge";

describe("faviconBadgeLabel", () => {
  it("shows single digits as they are and caps the rest", () => {
    expect(faviconBadgeLabel(1)).toBe("1");
    expect(faviconBadgeLabel(9)).toBe("9");
    expect(faviconBadgeLabel(10)).toBe("9+");
    expect(faviconBadgeLabel(250)).toBe("9+");
  });
});
