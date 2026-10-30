// Labels an issue with the provider its bug form names, "provider: <Name>", which lists it under Known problems on
// that provider's page on the website. Run by .github/workflows/issue-provider-label.yml; the rest is plain functions
// so they can be tried under Node.

import { readFileSync } from "node:fs";

const QUESTION = "Provider";
const PREFIX = "provider: ";

/**
 * An answer in an issue form's body, as GitHub writes it: "### <label>", a blank line and the answer, for each
 * question in order, with "_No response_" for one left empty. Null when the question isn't there or wasn't answered.
 * @param {string | null | undefined} body
 * @param {string} label
 */
export function formAnswer(body, label) {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `### ${label}`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("### "));
  const answer = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
  return answer === "" || answer === "_No response_" ? null : answer;
}

/**
 * The provider labels, from their generated block in .github/labels.yml (scripts/sync-providers.mjs writes it, one
 * `- name:` / `color:` / `description:` entry per provider), so only a provider's own answer gets a label.
 * @param {string} text
 * @returns {{ name: string; color: string; description: string }[]}
 */
export function providerLabels(text) {
  const block = /^# providers:labels\n([^]*?)^# \/providers:labels$/m.exec(text.replace(/\r\n?/g, "\n"));
  if (!block) throw new Error("labels.yml has no # providers:labels block");
  const value = (raw) => (raw.startsWith('"') ? JSON.parse(raw) : raw);
  return [...block[1].matchAll(/^- name: (.+)\n {2}color: (.+)\n {2}description: (.+)$/gm)].map(
    ([, name, color, description]) => ({ name: value(name), color: value(color), description: value(description) }),
  );
}

/**
 * What to change on an issue: the label its Provider answer calls for, if it lacks it, and the one the answer before
 * an edit called for, if that's changed. Labels nobody's answer called for, such as one a maintainer added, stay.
 * @param {object} issue
 * @param {"opened" | "edited"} issue.action
 * @param {string | null | undefined} issue.body
 * @param {string | null | undefined} [issue.previousBody] its body before an edit; undefined when an edit left it
 * @param {string[]} issue.labels the labels it has
 * @param {string[]} known every provider label
 */
export function labelChanges({ action, body, previousBody, labels }, known) {
  const none = { add: null, remove: [] };
  // An edit of the title alone.
  if (action === "edited" && previousBody === undefined) return none;
  const labelOf = (text) => {
    const answer = formAnswer(text, QUESTION);
    return answer !== null && known.includes(PREFIX + answer) ? PREFIX + answer : null;
  };
  const wanted = labelOf(body);
  const before = action === "edited" ? labelOf(previousBody) : null;
  return {
    add: wanted && !labels.includes(wanted) ? wanted : null,
    remove: before && before !== wanted && labels.includes(before) ? [before] : [],
  };
}

/** The workflow's step: `github` and `context` as actions/github-script hands them over. */
export default async function run({ github, context, core, labelsFile }) {
  const { action, issue, changes } = context.payload;
  const labels = providerLabels(readFileSync(labelsFile, "utf8"));
  const { add, remove } = labelChanges(
    {
      action,
      body: issue.body,
      previousBody: changes?.body ? (changes.body.from ?? "") : undefined,
      labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name)),
    },
    labels.map((label) => label.name),
  );
  const target = { ...context.repo, issue_number: issue.number };
  const ignore = (status) => (error) => {
    if (error.status !== status) throw error;
  };

  for (const name of remove) {
    core.info(`Removing ${name}`);
    await github.rest.issues.removeLabel({ ...target, name }).catch(ignore(404));
  }
  if (!add) return;
  // Labels are synced from labels.yml on main, so a provider added since has none yet: made here as it will be, rather
  // than in the grey GitHub gives a label that adding one makes.
  const label = labels.find((l) => l.name === add);
  const exists = await github.rest.issues.getLabel({ ...context.repo, name: add }).then(
    () => true,
    (error) => (error.status === 404 ? false : Promise.reject(error)),
  );
  if (!exists) {
    core.info(`Creating ${add}`);
    // 422: made meanwhile, by another run.
    await github.rest.issues.createLabel({ ...context.repo, ...label }).catch(ignore(422));
  }
  core.info(`Adding ${add}`);
  await github.rest.issues.addLabels({ ...target, labels: [add] });
}
