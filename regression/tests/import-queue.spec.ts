import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext, APIResponse, Browser, Locator, Page } from "@playwright/test";
import { ADMIN, authToken, expect, test } from "./helpers";

// Links come from the fake provider (fixtures/fake-provider.cjs), which the first digit of a model's id steers.
const KINDS = { plain: "1", held: "2", breaks: "3" };
const GATES = path.join(__dirname, "..", "fake-provider-gates");
const PASSWORD = "regression-password";
// Runs through several fast polls of the queue.
const IMPORT_TIMEOUT = 30_000;

test.describe.configure({ timeout: 90_000 });

type QueueOut = {
  jobs: { id: string; can_delete: boolean }[];
  line: { now: { job_id: string | null } | null };
  settings: { start_grab_links: boolean };
};

let nextId = Date.now() % 1e8;
const modelId = (kind: keyof typeof KINDS = "plain") => `${KINDS[kind]}${String(nextId++ % 1e8).padStart(8, "0")}`;
const linkTo = (id: string) => `https://makerworld.com/en/models/${id}`;
const modelName = (id: string) => `Regression model ${id}`;

const held = new Set<string>();
function heldModel() {
  const id = modelId("held");
  held.add(id);
  return id;
}
function release(id: string) {
  fs.mkdirSync(GATES, { recursive: true });
  fs.writeFileSync(path.join(GATES, id), "");
  held.delete(id);
}

/** The API as one account, for what a test sets up or clears away rather than checks. */
function client(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const sent = async <T = unknown>(what: string, response: APIResponse): Promise<T> => {
    if (!response.ok()) throw new Error(`${what} -> ${response.status()}: ${await response.text()}`);
    return response.json();
  };
  return {
    queue: async () => sent<QueueOut>("GET /api/import/queue", await request.get("/api/import/queue", { headers })),
    /** What the web app sends: into the line. */
    enqueue: async (url: string) =>
      sent<{ job_id: string; position: number }>(
        "POST /api/import",
        await request.post("/api/import?queue=1", { headers, data: { url } }),
      ),
    /** What Grab's "Add to the queue" sends: on hold, with nothing fetched. */
    addToHold: async (url: string) =>
      sent("POST /api/import/queue", await request.post("/api/import/queue", { headers, data: { url } })),
    remove: async (jobId: string) =>
      sent("DELETE job", await request.delete(`/api/import/queue/jobs/${jobId}`, { headers })),
    /** The fake provider takes any sign-in, but the import asks for one. */
    signInToProvider: async () =>
      sent(
        "PATCH /api/settings/makerworld",
        await request.patch("/api/settings/makerworld", { headers, data: { cookie: "token=regression" } }),
      ),
    setStartGrabLinks: async (value: boolean) =>
      sent(
        "PUT /api/import/queue/settings",
        await request.put("/api/import/queue/settings", { headers, data: { start_grab_links: value } }),
      ),
  };
}
type Client = ReturnType<typeof client>;

/** The line is one for the whole server, so a test leaves it empty for the next. */
async function clearQueue(account: Client) {
  await expect
    .poll(async () => (await account.queue()).jobs.every((job) => job.can_delete), { timeout: IMPORT_TIMEOUT })
    .toBe(true);
  for (const job of (await account.queue()).jobs) await account.remove(job.id);
}

/** Starts an import the fake provider won't let finish, and waits for the line to be on it. */
async function holdTheLine(account: Client) {
  const id = heldModel();
  const { job_id: jobId } = await account.enqueue(linkTo(id));
  await expect.poll(async () => (await account.queue()).line.now?.job_id, { timeout: IMPORT_TIMEOUT }).toBe(jobId);
  return id;
}

const indicator = (page: Page) => page.getByRole("button", { name: /^Import queue: / });
const queueDialog = (page: Page, title = "Import queue") => page.getByRole("dialog", { name: title, exact: true });
const section = (dialog: Locator, name: string) => dialog.getByRole("button", { name: new RegExp(`^${name}`) });
const whose = (dialog: Locator, name: string) =>
  dialog.getByRole("group", { name: "Whose imports" }).getByRole("button", { name });
/** A job's label is its link until it has run, and the model's name after that. Both have the id. */
const jobCard = (dialog: Locator, id: string) => dialog.getByRole("article", { name: new RegExp(id) });
const toast = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });

async function expectChosen(button: Locator) {
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

const linkField = (dialog: Locator) => dialog.getByPlaceholder(/^Paste model links/);
const importDialog = (page: Page) => page.getByRole("dialog", { name: "Import from link" });

/** Add -> Import, and waits for the dialog to close: what's submitted goes on in the background. */
async function addLink(page: Page, url: string) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import", exact: true }).click();
  const dialog = importDialog(page);
  await linkField(dialog).fill(url);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function deleteFromMenu(page: Page) {
  await page.getByRole("menuitem", { name: "Delete import" }).click();
  return page.getByRole("dialog", { name: "Delete this import?" });
}

const accounts = new Set<Client>();

/** A second account, signed in through the form in a browser of its own. */
async function signUp(browser: Browser, request: APIRequestContext, displayName: string) {
  const email = `queue-${Date.now()}-${accounts.size}@regression.test`;
  const res = await request.post("/api/register", { data: { email, password: PASSWORD, displayName } });
  expect(res.ok()).toBe(true);
  const account = client(request, (await res.json()).token);
  accounts.add(account);
  await account.signInToProvider();

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  return { account, page, context, email };
}

let admin: Client;

test.beforeEach(async ({ page, request }) => {
  await page.goto("/");
  admin = client(request, await authToken(page));
  accounts.add(admin);
  await admin.signInToProvider();
  await clearQueue(admin);
});

test.afterEach(async () => {
  for (const id of [...held]) release(id);
  for (const account of accounts) await clearQueue(account);
  accounts.clear();
});

test("the top bar's button opens the queue, by keyboard too, and takes the focus back", async ({ page }) => {
  await page.goto("/models");
  const button = indicator(page);
  await button.focus();
  await page.keyboard.press("Enter");

  const dialog = queueDialog(page);
  await expect(dialog).toBeVisible();
  // With nothing going on it opens where things will show.
  await expectChosen(section(dialog, "Importing"));
  await expect(dialog.getByText("Nothing importing")).toBeVisible();
  await expect(whose(dialog, "Mine")).toHaveAttribute("aria-pressed", "true");

  const empties: [string, string][] = [
    ["Needs attention", "All clear"],
    ["Waiting", "Nothing waiting"],
    ["Finished", "Nothing finished yet"],
  ];
  for (const [name, message] of empties) {
    await section(dialog, name).click();
    await expectChosen(section(dialog, name));
    await expect(dialog.getByText(message)).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  await expect(page).toHaveURL(/\/models$/);
});

for (const link of ["/admin-queue", "/import-queue"]) {
  test(`${link} opens everyone's imports for an admin, and leaves the address`, async ({ page }) => {
    await page.goto(link);
    const dialog = queueDialog(page, "Server import queue");
    await expect(dialog).toBeVisible();
    await expectChosen(whose(dialog, "Everyone"));
    await expectChosen(section(dialog, "Waiting"));
    await expect(page).toHaveURL(/\/$/);
  });

  test(`${link} opens a member's own imports`, async ({ browser, request }) => {
    const member = await signUp(browser, request, "Queue Link Member");
    await member.page.goto(link);
    const dialog = queueDialog(member.page);
    await expect(dialog).toBeVisible();
    await expectChosen(section(dialog, "Waiting"));
    await expect(dialog.getByRole("group", { name: "Whose imports" })).toHaveCount(0);
    await expect(member.page).toHaveURL(/\/$/);
    await member.context.close();
  });
}

test("a link to a section lands there, on the viewer's own imports, and comes off the address", async ({ page }) => {
  const sections = { run: "Importing", att: "Needs attention", wait: "Waiting", done: "Finished" };
  for (const [value, name] of Object.entries(sections)) {
    await page.goto(`/models?import-queue=${value}`);
    const dialog = queueDialog(page);
    await expect(dialog).toBeVisible();
    await expectChosen(section(dialog, name));
    await expectChosen(whose(dialog, "Mine"));
    await expect(page).toHaveURL(/\/models$/);
  }

  // Read once: coming back to the page doesn't bring it up again.
  await page.reload();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await expect(queueDialog(page)).toBeHidden();
});

// What notifications and Grab write, and what stored notifications keep.
for (const link of ["/admin-queue", "/import-queue"]) {
  test(`${link} with a section lands on that section`, async ({ page }) => {
    await page.goto(`${link}?import-queue=att`);
    const dialog = queueDialog(page);
    await expect(dialog).toBeVisible();
    await expectChosen(section(dialog, "Needs attention"));
    await expectChosen(whose(dialog, "Mine"));
    await expect(page).toHaveURL(/\/$/);
  });
}

test("Administration's entry opens everyone's imports over the page it's on", async ({ page }) => {
  await page.goto("/admin-users");
  await page.getByRole("navigation", { name: "Administration" }).getByRole("button", { name: "Import queue" }).click();
  const dialog = queueDialog(page, "Server import queue");
  await expect(dialog).toBeVisible();
  await expectChosen(section(dialog, "Waiting"));
  await expect(page).toHaveURL(/\/admin-users$/);
});

test("on a backend older than the queue there's no indicator, and an admin still gets everyone's", async ({ page }) => {
  await page.route("**/api/import/queue", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 404, json: {} }) : route.continue(),
  );
  await page.goto("/models");
  await expect(indicator(page)).toHaveCount(0);
  // No sign-out, either.
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();

  await page.goto("/?import-queue=wait");
  const dialog = queueDialog(page, "Server import queue");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Whose imports" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Queue settings" })).toHaveCount(0);
  await expect(indicator(page)).toHaveCount(0);
});

test("the Add dialog closes on submit, and a refused link comes back with Try again", async ({ page }) => {
  const refused = "http://localhost/regression.stl";
  await page.goto("/models");
  await addLink(page, refused);

  const failure = toast(page, "Local addresses are not allowed");
  await failure.getByRole("button", { name: "Try again" }).click();
  const dialog = importDialog(page);
  await expect(dialog).toBeVisible();
  await expect(linkField(dialog)).toHaveValue(refused);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("double-clicking Import sends the links once", async ({ page }) => {
  await holdTheLine(admin);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/import")) {
      sent.push(request.url());
    }
  });

  await page.goto("/models");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import", exact: true }).click();
  const dialog = importDialog(page);
  const links = [modelId(), modelId()].map(linkTo);
  await linkField(dialog).fill(links.join("\n"));
  await dialog.getByRole("button", { name: "Import", exact: true }).dblclick();
  await expect(dialog).toBeHidden();

  await expect(toast(page, "Added to the queue.")).toBeVisible();
  expect(sent).toHaveLength(1);
  // The one holding the line, and these.
  expect((await admin.queue()).jobs).toHaveLength(2);
});

test("a link goes through the line to Finished, without leaving the page, and the toast opens it", async ({
  page,
  api,
}) => {
  const id = heldModel();
  const name = modelName(id);
  await page.goto("/models");
  await addLink(page, linkTo(id));
  await expect(toast(page, "Added to the queue.")).toBeVisible();

  const importing = page.getByRole("button", { name: /^Import queue: Importing/ });
  await expect(importing).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await importing.click();
  const dialog = queueDialog(page);
  await expectChosen(section(dialog, "Importing"));
  await expect(jobCard(dialog, id).getByText("Importing", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  release(id);
  const finished = toast(page, `Imported "${name}"`);
  await expect(finished).toBeVisible({ timeout: IMPORT_TIMEOUT });
  // Nothing jumped, and the page picked the model up by itself.
  await expect(page).toHaveURL(/\/models$/);
  await expect(page.getByRole("main").getByText(name)).toBeVisible();

  await finished.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/models\/[^/?]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await api.printsNamed(name);

  await indicator(page).click();
  await section(dialog, "Finished").click();
  await expect(jobCard(dialog, id).getByText("Done", { exact: true })).toBeVisible();
  await expect(section(dialog, "Finished")).toContainText("1");

  await jobCard(dialog, id)
    .getByRole("button", { name: /^More actions for/ })
    .click();
  await page.getByRole("menuitem", { name: "Open model" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("a link that fails lands in Needs attention, and its toast opens it there", async ({ page }) => {
  const id = modelId("breaks");
  await page.goto("/models");
  await addLink(page, linkTo(id));

  const failed = toast(page, "Couldn't import");
  await failed.getByRole("button", { name: "Open" }).click({ timeout: IMPORT_TIMEOUT });
  const dialog = queueDialog(page);
  await expectChosen(section(dialog, "Needs attention"));
  await expect(section(dialog, "Needs attention")).toContainText("1");
  await expect(jobCard(dialog, id).getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Import queue: .*1 needs attention/, includeHidden: true }),
  ).toHaveCount(1);
});

test("Hold takes an import out of the line, past its turn, and Start puts it back", async ({ page }) => {
  const running = await holdTheLine(admin);
  const waiting = modelId();
  await admin.enqueue(linkTo(waiting));

  await page.goto("/?import-queue=wait");
  const dialog = queueDialog(page);
  const card = jobCard(dialog, waiting);
  await expect(card.getByText("#1", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Hold" }).click();
  await expect(dialog.getByText(/^On hold · 1$/)).toBeVisible();
  await expect(card.getByText("#1", { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText("#1", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Hold" }).click();
  await expect(card.getByRole("button", { name: "Start" })).toBeVisible();

  // The line finishes what it's on and passes this one by.
  release(running);
  await section(dialog, "Finished").click();
  await expect(jobCard(dialog, running).getByText("Done", { exact: true })).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await section(dialog, "Waiting").click();
  await expect(card.getByText("On hold", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Start" }).click();
  await section(dialog, "Finished").click();
  await expect(jobCard(dialog, waiting).getByText("Done", { exact: true })).toBeVisible({ timeout: IMPORT_TIMEOUT });
});

test("Hold and Start keep the keyboard on the card they moved, and a poll leaves focus alone", async ({ page }) => {
  const running = await holdTheLine(admin);
  const waiting = modelId();
  await admin.enqueue(linkTo(waiting));

  await page.goto("/?import-queue=wait");
  const dialog = queueDialog(page);
  const card = jobCard(dialog, waiting);

  await card.getByRole("button", { name: "Hold" }).focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: "Start" })).toBeFocused();
  // Carries on from the card, not from the top of the dialog.
  await page.keyboard.press("Tab");
  await expect(card.getByRole("button", { name: /^More actions for/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");

  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: "Hold" })).toBeFocused();

  const cog = dialog.getByRole("button", { name: "Queue settings" });
  await cog.focus();
  release(running);
  await expect(card.getByRole("button", { name: "Hold" })).toHaveCount(0, { timeout: IMPORT_TIMEOUT });
  await expect(cog).toBeFocused();
});

test("Clear finished asks first: Cancel leaves them, and confirming clears them", async ({ page }) => {
  const id = modelId();
  await admin.enqueue(linkTo(id));

  await page.goto("/?import-queue=done");
  const dialog = queueDialog(page);
  await expect(jobCard(dialog, id).getByText("Done", { exact: true })).toBeVisible({ timeout: IMPORT_TIMEOUT });
  const clear = dialog.getByRole("button", { name: "Clear finished (1)" });
  const confirm = page.getByRole("dialog", { name: "Clear finished imports?" });

  await clear.click();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(jobCard(dialog, id)).toBeVisible();
  expect((await admin.queue()).jobs).toHaveLength(1);

  const status = dialog.getByRole("status");
  await status.evaluate((region: HTMLElement) => {
    new MutationObserver(() => {
      if (region.textContent?.startsWith("Cleared")) {
        region.dataset.saidHidden ??= String(Boolean(region.closest('[aria-hidden="true"]')));
      }
    }).observe(region, { childList: true });
  });

  await clear.click();
  await confirm.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(jobCard(dialog, id)).toBeHidden();
  await expect(dialog.getByText("Nothing finished yet")).toBeVisible();
  expect((await admin.queue()).jobs).toEqual([]);
  // The toast is behind the dialog, for a screen reader, so the dialog says it instead, and it's said once.
  await expect(status).toHaveText("Cleared 1 finished import.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Not while the closing confirmation still hid the dialog: inside that, it wouldn't be heard.
  await expect(status).toHaveAttribute("data-said-hidden", "false");
});

test("Everyone's Clear finished says how many and whose, and clears as far as it says", async ({
  page,
  browser,
  request,
}) => {
  const displayName = "Queue Clear Member";
  const member = await signUp(browser, request, displayName);
  const [mine, theirs, theirsToo] = [modelId(), modelId(), modelId()];
  await admin.enqueue(linkTo(mine));
  await member.account.enqueue(linkTo(theirs));
  await member.account.enqueue(linkTo(theirsToo));

  await page.goto("/admin-queue");
  const dialog = queueDialog(page, "Server import queue");
  await section(dialog, "Finished").click();
  for (const id of [mine, theirs, theirsToo]) {
    await expect(jobCard(dialog, id).getByText("Done", { exact: true })).toBeVisible({ timeout: IMPORT_TIMEOUT });
  }
  const confirm = page.getByRole("dialog", { name: "Clear finished imports?" });

  await dialog.getByRole("button", { name: "Clear finished (3)" }).click();
  await expect(confirm).toContainText("This clears 3 finished imports, other people's too");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();

  // With someone picked it's only theirs, and it says so.
  await dialog.getByRole("button", { name: new RegExp(`^${displayName}`) }).click();
  await dialog.getByRole("button", { name: "Clear finished (2)" }).click();
  await expect(confirm).toContainText(`This clears 2 finished imports of ${displayName}`);
  await expect(confirm).not.toContainText("other people's");
  await confirm.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(confirm).toBeHidden();

  await expect(dialog.getByRole("status")).toHaveText("Cleared 2 finished imports.");
  expect((await member.account.queue()).jobs).toEqual([]);
  expect((await admin.queue()).jobs).toHaveLength(1);
  await member.context.close();
});

test("Remove link takes out one link, and Delete asks first", async ({ page }) => {
  const [kept, removed] = [modelId(), modelId()];
  await admin.addToHold(linkTo(kept));
  await admin.addToHold(linkTo(removed));

  await page.goto("/?import-queue=wait");
  const dialog = queueDialog(page);
  const card = dialog.getByRole("article", { name: "Sent from Thingport Grab" });
  await card.getByRole("button", { name: "Show 2 links" }).click();
  const links = card.getByRole("link");
  await expect(links).toHaveText([linkTo(kept), linkTo(removed)]);

  await card.getByRole("button", { name: "Remove link" }).nth(1).click();
  await expect(links).toHaveText([linkTo(kept)]);

  // A right click opens the same menu as the button.
  await card.getByRole("button", { name: "Hide 1 link" }).click({ button: "right" });
  const confirm = await deleteFromMenu(page);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: /^More actions for/ }).click();
  const confirmAgain = await deleteFromMenu(page);
  await confirmAgain.getByRole("button", { name: "Delete" }).click();
  await expect(card).toBeHidden();
  await expect(dialog.getByText("Nothing waiting")).toBeVisible();
  expect((await admin.queue()).jobs).toEqual([]);
});

test("Remove link and Delete leave the keyboard on the next card, and then on the heading", async ({ page }) => {
  await holdTheLine(admin);
  const [kept, gone] = [modelId(), modelId()];
  await admin.enqueue(linkTo(gone));
  await admin.addToHold(linkTo(kept));
  await admin.addToHold(linkTo(modelId()));

  await page.goto("/?import-queue=wait");
  const dialog = queueDialog(page);
  const held = dialog.getByRole("article", { name: "Sent from Thingport Grab" });
  await held.getByRole("button", { name: "Show 2 links" }).click();

  await held.getByRole("button", { name: "Remove link" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(held.getByRole("button", { name: "Start" })).toBeFocused();

  const waiting = jobCard(dialog, gone);
  await waiting.getByRole("button", { name: /^More actions for/ }).focus();
  await page.keyboard.press("Enter");
  const confirm = await deleteFromMenu(page);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(waiting).toBeHidden();
  await expect(held.getByRole("button", { name: "Start" })).toBeFocused();

  await held.getByRole("button", { name: /^More actions for/ }).focus();
  await page.keyboard.press("Enter");
  const confirmAgain = await deleteFromMenu(page);
  await confirmAgain.getByRole("button", { name: "Delete" }).click();
  await expect(held).toBeHidden();
  await expect(dialog.getByText("Nothing waiting")).toBeVisible();
  await expect(dialog.locator("[data-queue-heading]")).toBeFocused();
});

test("Clear finished leaves the keyboard on the heading once its button has gone", async ({ page }) => {
  const id = modelId();
  await admin.enqueue(linkTo(id));

  await page.goto("/?import-queue=done");
  const dialog = queueDialog(page);
  await expect(jobCard(dialog, id).getByText("Done", { exact: true })).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await dialog.getByRole("button", { name: "Clear finished (1)" }).focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "Clear finished imports?" });
  await confirm.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(dialog.getByText("Nothing finished yet")).toBeVisible();
  await expect(dialog.locator("[data-queue-heading]")).toBeFocused();
});

test("a tag's page and search results pick up a model that finishes while they're open", async ({ page }) => {
  /** The queue's first read only takes note of what's there, so what finishes has to come after it. */
  const open = async (path: string) => {
    const firstRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/import/queue");
    await page.goto(path);
    await firstRead;
  };

  // The fake provider's models all carry this tag.
  await open("/models/tags/regression");
  const first = modelId();
  await admin.enqueue(linkTo(first));
  await expect(page.getByRole("main").getByText(modelName(first))).toBeVisible({ timeout: IMPORT_TIMEOUT });

  const second = modelId();
  await open(`/search-results?q=${encodeURIComponent(modelName(second))}`);
  await expect(page.getByRole("main").getByText(modelName(second))).toHaveCount(0);
  await admin.enqueue(linkTo(second));
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(second) })).toBeVisible({
    timeout: IMPORT_TIMEOUT,
  });
});

test("a queue link outlasts a session that has ended, and opens after signing back in", async ({
  browser,
  request,
}) => {
  const member = await signUp(browser, request, "Queue Ended Session");
  const token = await authToken(member.page);
  // Off the app first, or its next read would find out and forget the token.
  await member.page.goto("about:blank");
  const ended = await member.context.request.post("/api/logout", { headers: { Authorization: `Bearer ${token}` } });
  expect(ended.ok()).toBe(true);

  // Still a stored token that looks good, which only the first requests find out about.
  await member.page.goto("/admin-queue?import-queue=att");
  await member.page.getByLabel("Email").fill(member.email);
  await member.page.getByLabel("Password").fill(PASSWORD);
  await member.page.getByRole("button", { name: "Sign in" }).click();

  const dialog = queueDialog(member.page);
  await expect(dialog).toBeVisible();
  await expectChosen(section(dialog, "Needs attention"));
  await expect(member.page).toHaveURL(/\/$/);
  await member.context.close();
});

test("another person's waiting import is a private row, and only an admin sees whose", async ({
  page,
  browser,
  request,
}) => {
  const running = await holdTheLine(admin);
  const waiting = modelId();
  await admin.enqueue(linkTo(waiting));

  const displayName = "Queue Second Member";
  const member = await signUp(browser, request, displayName);
  const answers: Promise<string>[] = [];
  member.page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/")) answers.push(response.text().catch(() => ""));
  });

  const mine = modelId();
  await addLink(member.page, linkTo(mine));
  await expect(toast(member.page, "Added to the queue. It's #2 in line.")).toBeVisible();

  const button = member.page.getByRole("button", { name: /^Import queue: Your next import is #2 in line/ });
  await button.click({ timeout: IMPORT_TIMEOUT });
  const dialog = queueDialog(member.page);
  await expectChosen(section(dialog, "Waiting"));
  await expect(dialog.getByRole("article")).toHaveCount(1);
  await expect(jobCard(dialog, mine).getByText("#2", { exact: true })).toBeVisible();
  // What's on now, and #1.
  await expect(dialog.getByText("Now", { exact: true })).toBeVisible();
  await expect(dialog.getByText("#1", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Private import", { exact: true })).toHaveCount(2);

  const seen = [await member.page.content(), ...(await Promise.all(answers))].join("\n");
  for (const secret of [running, waiting, ADMIN.displayName, ADMIN.email]) expect(seen).not.toContain(secret);

  await page.goto("/admin-queue");
  const everyone = queueDialog(page, "Server import queue");
  await expect(jobCard(everyone, mine).getByText(displayName, { exact: false })).toBeVisible();
  await expect(jobCard(everyone, waiting)).toBeVisible();
  await everyone.getByRole("button", { name: new RegExp(`^${displayName}`) }).click();
  await expect(everyone.getByRole("article")).toHaveCount(1);
  await expect(jobCard(everyone, mine)).toBeVisible();

  await member.context.close();
});

test("the cog's switch stays through a reload", async ({ page }) => {
  const setting = page.getByRole("switch", { name: /^Start links from Grab automatically/ });
  try {
    await page.goto("/models");
    await indicator(page).click();
    await queueDialog(page).getByRole("button", { name: "Queue settings" }).click();
    await expect(setting).not.toBeChecked();

    const saved = page.waitForResponse((r) => r.url().endsWith("/api/import/queue/settings") && r.ok());
    await setting.click();
    await saved;
    await expect(setting).toBeChecked();
    await expect(page.getByText("New links go straight into the line.")).toBeVisible();

    await page.reload();
    await indicator(page).click();
    await queueDialog(page).getByRole("button", { name: "Queue settings" }).click();
    await expect(setting).toBeChecked();
    expect((await admin.queue()).settings.start_grab_links).toBe(true);
  } finally {
    await admin.setStartGrabLinks(false);
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test("the queue opens from the top bar and fits the screen", async ({ page }) => {
    await page.goto("/models");
    await indicator(page).click();
    const dialog = queueDialog(page);
    await expect(dialog).toBeVisible();
    await section(dialog, "Waiting").click();
    await expect(dialog.getByText("Nothing waiting")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(393);
  });
});
