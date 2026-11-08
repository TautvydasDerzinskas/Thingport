import { afterEach, describe, expect, it, vi } from "vitest";
import { shortDate } from "./ClockCard";

afterEach(() => vi.restoreAllMocks());

describe("shortDate", () => {
  it("uses Belarusian parts when Chromium lacks the be locale", () => {
    vi.spyOn(Intl.DateTimeFormat, "supportedLocalesOf").mockReturnValue([]);
    expect(shortDate("be", new Date(2026, 10, 8, 12))).toEqual({ weekday: "нд", day: "8 ліст." });
  });
});
