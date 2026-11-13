import { describe, expect, it } from "vitest";
import { latestRequests } from "./latestRequests";

describe("latestRequests", () => {
  it("counts only the newest request's answer, however late an older one's comes", () => {
    const requests = latestRequests();
    const first = requests.next();
    const second = requests.next();
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
