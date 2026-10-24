import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCaptchaChallenge,
  liftCaptchaCooloffByHand,
  makerworldCaptchaCooloffActive,
  noteCaptchaChallenge,
  resetCaptchaCooloffForTest,
} from "../src/providers/makerworld/captcha";

describe("isCaptchaChallenge", () => {
  it("spots the real challenge shapes", () => {
    expect(isCaptchaChallenge({ captchaId: "abc", error: "We need you to confirm you are not a robot" })).toBe(true);
    expect(isCaptchaChallenge({ captcha_id: "abc" })).toBe(true);
    expect(isCaptchaChallenge({ code: 1, message: "Please complete the captcha" })).toBe(true);
    expect(isCaptchaChallenge({ msg: "confirm you are not a robot" })).toBe(true);
  });

  it("doesn't take a design that talks about robots or captchas for a challenge", () => {
    expect(isCaptchaChallenge({ id: 1, title: "Robot vacuum dock", summary: "<p>For my robot</p>" })).toBe(false);
    expect(isCaptchaChallenge({ id: 2, title: "CAPTCHA keychain", tags: ["captcha"] })).toBe(false);
    expect(isCaptchaChallenge({ message: "success", url: "https://cdn.example.com/robot-arm.3mf" })).toBe(false);
  });

  it("needs a value on a captcha key, so a flag saying there's none isn't a challenge", () => {
    expect(isCaptchaChallenge({ id: 3, captchaRequired: false })).toBe(false);
    expect(isCaptchaChallenge({ captchaId: "" })).toBe(false);
    expect(isCaptchaChallenge({ captcha: null })).toBe(false);
  });

  it("ignores anything that isn't an object", () => {
    expect(isCaptchaChallenge(null)).toBe(false);
    expect(isCaptchaChallenge("captcha")).toBe(false);
    expect(isCaptchaChallenge(["captchaId"])).toBe(false);
  });
});

describe("the CAPTCHA cooloff", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetCaptchaCooloffForTest();
  });

  it("can be lifted by hand once a person has solved the puzzle", () => {
    noteCaptchaChallenge();
    expect(makerworldCaptchaCooloffActive()).toBe(true);
    liftCaptchaCooloffByHand();
    expect(makerworldCaptchaCooloffActive()).toBe(false);
  });

  it("is lifted by hand at most once every five minutes, so retrying can't keep probing a block", () => {
    vi.useFakeTimers({ now: new Date("2026-10-14T10:00:00Z") });
    noteCaptchaChallenge();
    liftCaptchaCooloffByHand();
    // The retry met the CAPTCHA again.
    noteCaptchaChallenge();
    vi.setSystemTime(new Date("2026-10-14T10:04:00Z"));
    liftCaptchaCooloffByHand();
    expect(makerworldCaptchaCooloffActive()).toBe(true);

    vi.setSystemTime(new Date("2026-10-14T10:05:00Z"));
    liftCaptchaCooloffByHand();
    expect(makerworldCaptchaCooloffActive()).toBe(false);
  });

  it("doesn't spend the five minutes when there's nothing to lift", () => {
    vi.useFakeTimers({ now: new Date("2026-10-14T10:00:00Z") });
    liftCaptchaCooloffByHand();
    noteCaptchaChallenge();
    vi.setSystemTime(new Date("2026-10-14T10:01:00Z"));
    liftCaptchaCooloffByHand();
    expect(makerworldCaptchaCooloffActive()).toBe(false);
  });
});
