import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardMark, focusingCardAfter, headingMark, keepingFocus, keepingPanelFocus, primaryMark } from "./queueFocus";

// No DOM in the test run, so just enough of one: a dialog of cards, each with a primary button or not. The browser's half
// of this is in regression/tests/import-queue.spec.ts.

type Fake = {
  name: string;
  attrs: Record<string, string>;
  children: Fake[];
  parent: Fake | null;
  isConnected?: boolean;
  disabled?: boolean;
  focus: () => void;
  contains: (other: unknown) => boolean;
  closest: (selector: string) => Fake | null;
  querySelector: (selector: string) => Fake | null;
  querySelectorAll: (selector: string) => Fake[];
  getAttribute: (name: string) => string | null;
};

const doc = { activeElement: null as unknown };

const attrOf = (selector: string) => selector.match(/^\[([^\]=]+)/)?.[1] ?? "";

/** What the dialog's focus trap falls back on: it's around everything in the dialog. */
const dialogRoot = { name: "the dialog's root", contains: () => true };

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

const headingWith = (...children: Fake[]) =>
  fake("heading", headingMark as unknown as Record<string, string>, children);
const button = (name: string) => fake(name, primaryMark);
const cardWith = (id: string, ...children: Fake[]) => fake(`card ${id}`, cardMark(id), children);
const dialogOf = (...cards: Fake[]) => fake("dialog", { role: "dialog" }, cards);
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
  doc.activeElement = dialogRoot;
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
      doc.activeElement = dialogRoot;
    });
    expect((doc.activeElement as Fake).name).toBe("Start");
  });

  it("follows a mouse click too when focus was inside the card, as a browser that focuses buttons leaves it", async () => {
    const hold = button("Hold");
    const dialog = dialogOf(cardWith("a", hold));
    doc.activeElement = hold;
    await run(mouse(hold), "a", () => {
      dialog.children.splice(0, 1, cardWith("a", button("Start")));
      doc.activeElement = dialogRoot;
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
      doc.activeElement = dialogRoot;
    });
    expect((doc.activeElement as Fake).name).toBe("card a");
  });

  it("leaves focus alone for a mouse click from outside the card", async () => {
    const hold = button("Hold");
    dialogOf(cardWith("a", hold));
    await run(mouse(hold), "a");
    expect(doc.activeElement).toBe(dialogRoot);
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

  it("doesn't steal focus that has left the dialog meanwhile, for a menu or the top bar", async () => {
    const hold = button("Hold");
    dialogOf(cardWith("a", hold));
    const menuItem = fake("a menu's item");
    await run(keyboard(hold), "a", () => {
      doc.activeElement = menuItem;
    });
    expect(doc.activeElement).toBe(menuItem);
  });

  it("takes the next card when this one left the section, as a retry does", async () => {
    const retry = button("Retry");
    const next = button("Next");
    const dialog = dialogOf(cardWith("a", retry), cardWith("b", next));
    await run(keyboard(retry), "a", () => {
      dialog.children.splice(0, 1);
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(next);
  });

  it("takes the last card when it was the last, and leaves focus be when none are left", async () => {
    const first = button("First");
    const retry = button("Retry");
    const dialog = dialogOf(cardWith("a", first), cardWith("b", retry));
    await run(keyboard(retry), "b", () => {
      dialog.children.splice(1, 1);
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(first);

    await run(keyboard(first), "a", () => {
      dialog.children.length = 0;
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(dialogRoot);
  });

  it("goes to the panel's heading when no card is left", async () => {
    const retry = button("Retry");
    const heading = headingWith();
    const dialog = fake("dialog", { role: "dialog" }, [heading, cardWith("a", retry)]);
    await run(keyboard(retry), "a", () => {
      dialog.children.splice(1, 1);
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(heading);
  });
});

describe("keepingFocus, on a link's remove button", () => {
  const remove = () => fake("Remove link");

  it("stays in the card when it keeps other links, on its primary button", async () => {
    const x = remove();
    const start = button("Start");
    dialogOf(cardWith("a", start, x));
    doc.activeElement = x;
    await run(keyboard(x), "a");
    expect(doc.activeElement).toBe(start);
  });

  it("goes to the next card when its last link took the job with it", async () => {
    const x = remove();
    const next = button("Next");
    const dialog = dialogOf(cardWith("a", x), cardWith("b", next));
    await run(keyboard(x), "a", () => {
      dialog.children.splice(0, 1);
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(next);
  });
});

describe("focusingCardAfter", () => {
  const remove = async (card: Fake | null, afterAction: () => void) => {
    await focusingCardAfter(card as unknown as Element, async () => afterAction());
    vi.runAllTimers();
  };

  it("runs the action with no card to go by, as when it moved while the confirmation was open", async () => {
    const action = vi.fn<() => void>();
    await remove(null, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(doc.activeElement).toBe(dialogRoot);
  });

  it("goes to the card that took its place", async () => {
    const [gone, next] = [cardWith("a", button("A")), button("B")];
    const dialog = dialogOf(gone, cardWith("b", next));
    await remove(gone, () => {
      dialog.children.splice(0, 1);
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(next);
  });

  it("goes to the one before it, when it was the last", async () => {
    const first = button("A");
    const gone = cardWith("b", button("B"));
    const dialog = dialogOf(cardWith("a", first), gone);
    await remove(gone, () => {
      dialog.children.splice(1, 1);
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(first);
  });

  it("goes to the panel's heading when it was the only one", async () => {
    const heading = headingWith();
    const gone = cardWith("a", button("A"));
    const dialog = fake("dialog", { role: "dialog" }, [heading, gone]);
    await remove(gone, () => {
      dialog.children.splice(1, 1);
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(heading);
  });

  it("leaves focus alone if it has gone on somewhere by then", async () => {
    const [gone, other] = [cardWith("a", button("A")), button("B")];
    const dialog = dialogOf(gone, cardWith("b", other));
    await remove(gone, () => {
      dialog.children.splice(0, 1);
      doc.activeElement = other;
    });
    expect(doc.activeElement).toBe(other);
  });
});

describe("keepingPanelFocus", () => {
  function panel() {
    const bulk = Object.assign(fake("Clear finished"), { isConnected: true, disabled: false });
    const heading = headingWith(bulk);
    fake("dialog", { role: "dialog" }, [heading]);
    return { bulk, heading };
  }
  const press = async (bulk: Fake, afterAction: () => void) => {
    await keepingPanelFocus({ currentTarget: bulk as unknown as Element }, async () => afterAction());
    vi.runAllTimers();
  };

  it("goes to the heading when the button has gone", async () => {
    const { bulk, heading } = panel();
    await press(bulk, () => {
      bulk.isConnected = false;
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(heading);
  });

  it("goes to the heading when the button has turned off", async () => {
    const { bulk, heading } = panel();
    doc.activeElement = bulk;
    await press(bulk, () => {
      bulk.disabled = true;
    });
    expect(doc.activeElement).toBe(heading);
  });

  it("comes back to the button when it's still there, having turned off for the request", async () => {
    const { bulk } = panel();
    await press(bulk, () => {
      doc.activeElement = dialogRoot;
    });
    expect(doc.activeElement).toBe(bulk);
  });

  it("leaves focus alone if it has gone on somewhere by then", async () => {
    const { bulk } = panel();
    const elsewhere = fake("a card's button");
    await press(bulk, () => {
      bulk.isConnected = false;
      doc.activeElement = elsewhere;
    });
    expect(doc.activeElement).toBe(elsewhere);
  });

  it("has nothing to do outside a dialog", async () => {
    const bulk = Object.assign(fake("Clear finished"), { isConnected: true, disabled: false });
    await press(bulk, () => {
      bulk.isConnected = false;
    });
    expect(doc.activeElement).toBe(dialogRoot);
  });
});
