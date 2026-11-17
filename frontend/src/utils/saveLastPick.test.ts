import { describe, expect, it } from "vitest";
import { saveLastPick } from "./saveLastPick";

/** A save whose answers the test hands out one at a time. */
function heldSaves() {
  const asked: string[] = [];
  const answers: (() => void)[] = [];
  const save = (value: string) =>
    new Promise<string>((resolve) => {
      asked.push(value);
      answers.push(() => resolve(value));
    });
  const answer = async () => {
    answers.shift()!();
    // Lets the loop read the answer and send its next save.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { asked, save, answer };
}

describe("saving a row's last pick", () => {
  it("saves the last pick made while one was saving, skipping the ones in between", async () => {
    const { asked, save, answer } = heldSaves();
    let wanted = "25";
    const done = saveLastPick(
      () => wanted,
      save,
      () => false,
    );
    wanted = "100";
    wanted = "500";
    await answer();
    await answer();
    expect(await done).toBe("500");
    expect(asked).toEqual(["25", "500"]);
  });

  it("sends no waiting pick once the row has gone", async () => {
    const { asked, save, answer } = heldSaves();
    let wanted = "25";
    let gone = false;
    const done = saveLastPick(
      () => wanted,
      save,
      () => gone,
    );
    wanted = "500";
    gone = true;
    await answer();
    expect(await done).toBe("25");
    expect(asked).toEqual(["25"]);
  });
});
