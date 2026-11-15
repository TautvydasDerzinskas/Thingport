import { describe, expect, it } from "vitest";
import { latestRequests } from "./latestRequests";

describe("latestRequests", () => {
  it("drops an older request's answer once a newer one's is taken, however late it comes", () => {
    const requests = latestRequests();
    const first = requests.next();
    const second = requests.next();
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });

  it("takes an older request's answer while the newer one hasn't answered, as when it failed", () => {
    const requests = latestRequests();
    const first = requests.next();
    const second = requests.next();
    expect(first()).toBe(true);
    // A newer answer still counts over it, checked as often as it's needed.
    expect(second()).toBe(true);
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });

  it("counts none once cancelled, the newest included", () => {
    const requests = latestRequests();
    const pending = requests.next();
    requests.cancel();
    expect(pending()).toBe(false);
    expect(requests.next()()).toBe(true);
  });
});
