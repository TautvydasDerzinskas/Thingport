// "Report a problem" links: the repo's bug form, filled in from the link, so a report says where it came from. GitHub
// fills a form's fields from query parameters named by their ids, a dropdown only with one of its options word for
// word, so the build fails if the form or its labels no longer have what these links and lists rely on.

import form from "../../../.github/ISSUE_TEMPLATE/bug_report.yml?raw";
import labels from "../../../.github/labels.yml?raw";
import { LINKS } from "./site.mjs";

const TEMPLATE = "bug_report.yml";
const FORM_PATH = `.github/ISSUE_TEMPLATE/${TEMPLATE}`;
const LABELS_PATH = ".github/labels.yml";
const FORM = form.replace(/\r\n?/g, "\n");
const LABELS = labels.replace(/\r\n?/g, "\n");

/** The form's "Where?" answers the links give. */
export const WHERE = { app: "Thingport (web app)", docs: "Website or docs" };

/**
 * A form field's lines, from its `- type:` to the next field's, by its id. Fails the build when it's gone.
 * @param {string} id
 */
function field(id) {
  const fields = FORM.split(/^ {2}- type: /m).slice(1);
  const found = fields.find((text) => new RegExp(`^ {4}id: ${id}$`, "m").test(text));
  if (!found) throw new Error(`${FORM_PATH} has no field with the id ${id}, which "Report a problem" links fill in`);
  return found;
}

/**
 * Fails the build unless a dropdown has an option, as a link to the form gives it.
 * @param {string} id
 * @param {string} option
 */
function checkOption(id, option) {
  const options = [...field(id).matchAll(/^ {8}- (.+)$/gm)].map(([, value]) =>
    value.startsWith('"') ? JSON.parse(value) : value,
  );
  if (!options.includes(option)) {
    throw new Error(`${FORM_PATH}'s ${id} dropdown has no option "${option}": run npm run providers:sync`);
  }
}

/**
 * The label .github/workflows/issue-provider-label.yml gives an issue about a provider, by its bug form answer.
 * @param {string} name the provider's name
 */
export function providerLabel(name) {
  const label = `provider: ${name}`;
  if (!LABELS.includes(`- name: ${JSON.stringify(label)}\n`)) {
    throw new Error(`${LABELS_PATH} has no label "${label}": run npm run providers:sync`);
  }
  return label;
}

/**
 * A link to the bug form, filled in: its title starts with `title`, "Where?" is `where`, "Provider" is `provider`, if
 * given, and the details say it was reported from `page`, an absolute URL.
 * @param {{ title?: string; where: string; provider?: string; page: string }} report
 */
export function reportUrl({ title, where, provider, page }) {
  checkOption("component", where);
  if (provider) checkOption("provider", provider);
  field("details");
  const params = {
    template: TEMPLATE,
    ...(title && { title }),
    component: where,
    ...(provider && { provider }),
    details: `Reported from ${page}`,
  };
  // Spaces as %20, which reads as a space anywhere, rather than URLSearchParams' "+".
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${LINKS.issues}/new?${query}`;
}

/**
 * The repo's open issues with a label, on GitHub.
 * @param {string} label
 */
export const labelledIssuesUrl = (label) =>
  `${LINKS.issues}?q=${encodeURIComponent(`is:issue is:open label:"${label}"`)}`;
