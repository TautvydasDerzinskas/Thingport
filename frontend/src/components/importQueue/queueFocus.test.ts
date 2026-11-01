import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardMark, keepingFocus, primaryMark } from "./queueFocus";

// No DOM in the test run, so just enough of one: a dialog of cards, each with a primary button or not. The browser's half
// of this is in regression/tests/import-queue.spec.ts.

type Fake = {
  name: string;
  attrs: Record<string, string>;
  children: Fake[];
  parent: Fake | null;
  focus: () => void;
  contains: (other: unknown) => boolean;
  closest: (selector: string) => Fake | null;
  querySelector: (selector: string) => Fake | null;
  querySelectorAll: (selector: string) => Fake[];
  getAttribute: (name: string) => string | null;
};

const doc = { activeElement: null as unknown };

const attrOf = (selector: string) => selector.match(/^\[([^\]=]+)/)?.[1] ?? "";

function fake(name: string, attrs: Record<string, string> = {}, children: Fake[] = []): Fake {
  const self: Fake = {
    name,
    attrs,
    children,
    parent: null,
    focus: () => {
      doc.activeElement = self;
    },
    contains: (other) => other === self || children.some((child) => child.contains(other)),
    closest: (selector) => {
      const matches = selector === '[role="dialog"]' ? attrs.role === "dialog" : attrOf(selector) in attrs;
      return matches ? self : (self.parent?.closest(selector) ?? null);
    },
    querySelector: (selector) => self.querySelectorAll(selector)[0] ?? null,
    querySelectorAll: (selector) =>
      children.flatMap((child) => [
        ...(attrOf(selector) in child.attrs ? [child] : []),
        ...child.querySelectorAll(selector),
      ]),
    getAttribute: (key) => attrs[key] ?? null,
  };
  for (const child of children) child.parent = self;
  return self;
}

const button = (name: string) => fake(name, primaryMark);
const cardWith = (id: string, ...children: Fake[]) => fake(`card ${id}`, cardMark(id), children);
const dialogOf = (...cards: Fake[]) => fake("dialog", { role: "dialog" }, cards);
const elsewhere = fake("the dialog's root");
const keyboard = (target: Fake) => ({ detail: 0, currentTarget: target as unknown as Element });
const mouse = (target: Fake) => ({ detail: 1, currentTarget: target as unknown as Element });

/** The frame after the answer was drawn. */
async function run(event: ReturnType<typeof mouse>, jobId: string, afterAction: () => void = () => undefined) {
  await keepingFocus(event, jobId, async () => afterAction());
  vi.runAllTimers();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", (done: () => void) => setTimeout(done, 16));
  doc.activeElement = elsewhere;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("keepingFocus", () => {
  it("runs the action whatever else happens", async () => {
    const action = vi.fn<() => Promise<void>>(async () => undefined);
    const hold = button("Hold");
    dialogOf(cardWith("a", hold));
    await keepingFocus(mouse(hold), "a", action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("follows a card from the keyboard, to its primary button in its new place", async () => {
    const hold = button("Hold");
    const dialog = dialogOf(cardWith("a", hold));
    await run(keyboard(hold), "a", () => {
      // React makes the card anew in another group, and focus falls back to the dialog's root.
      const start = button("Start");
      dialog.children.splice(0, 1, cardWith("a", start));
      dialog.children[0].parent = dialog;
      doc.activeElement = elsewhere;
    });
    expect((doc.activeElement as Fake).name).toBe("Start");
  });

  it("follows a mouse click too when focus was inside the card, as a browser that focuses buttons leaves it", async () => {
    const hold = button("Hold");
    const dialog = dialogOf(cardWith("a", hold));
    doc.activeElement = hold;
    await run(mouse(hold), "a", () => {
      dialog.children.splice(0, 1, cardWith("a", button("Start")));
      doc.activeElement = elsewhere;
    });
    expect((doc.activeElement as Fake).name).toBe("Start");
  });

  it("goes to the card when it has nothing left to press", async () => {
    const pause = button("Pause");
    const card = cardWith("a", pause);
    dialogOf(card);
    doc.activeElement = pause;
    await run(keyboard(pause), "a", () => {
      card.children.length = 0;
      doc.activeElement = elsewhere;
    });
    expect((doc.activeElement as Fake).name).toBe("card a");
  });

  it("leaves focus alone for a mouse click from outside the card", async () => {
    const hold = button("Hold");
    dialogOf(cardWith("a", hold));
    await run(mouse(hold), "a");
    expect(doc.activeElement).toBe(elsewhere);
  });

  it("doesn't steal focus that has moved on to another card meanwhile", async () => {
    const hold = button("Hold");
    const other = button("Other");
    dialogOf(cardWith("a", hold), cardWith("b", other));
    await run(keyboard(hold), "a", () => {
      doc.activeElement = other;
    });
    expect(doc.activeElement).toBe(other);
  });

  it("takes the next card when this one left the section, as a retry does", async () => {
    const retry = button("Retry");
    const next = button("Next");
    const dialog = dialogOf(cardWith("a", retry), cardWith("b", next));
    await run(keyboard(retry), "a", () => {
      dialog.children.splice(0, 1);
      doc.activeElement = elsewhere;
    });
    expect(doc.activeElement).toBe(next);
  });

  it("takes the last card when it was the last, and leaves focus be when none are left", async () => {
    const first = button("First");
    const retry = button("Retry");
    const dialog = dialogOf(cardWith("a", first), cardWith("b", retry));
    await run(keyboard(retry), "b", () => {
      dialog.children.splice(1, 1);
      doc.activeElement = elsewhere;
    });
    expect(doc.activeElement).toBe(first);

    await run(keyboard(first), "a", () => {
      dialog.children.length = 0;
      doc.activeElement = elsewhere;
    });
    expect(doc.activeElement).toBe(elsewhere);
  });
});
