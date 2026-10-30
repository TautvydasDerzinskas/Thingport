// The panel's header: what is being imported, shown rather than only named. The model's own picture and name come
// from the page (content/pageModel.ts), so nothing is fetched for it; where the page shows no picture, the
// provider's mark stands in, which still reads as "this model, on this site" rather than as a gap.

import { ctx } from "../context";
import { escapeHtml } from "../runtime";
import { pageImage, pageTitle } from "../pageModel";
import { modelKey } from "../../shared/urls";
import { manifestOf } from "../../providers/index.generated";

/** The provider's logo, drawn as the popup's provider list draws it. */
function providerMarkHtml(): string {
  const { logo } = manifestOf(ctx().classification.provider).brand;
  const layers = (logo.layers ?? [])
    .map(
      (l) =>
        `<path d="${escapeHtml(l.d)}" fill="${escapeHtml(l.color)}"${l.fillRule ? ` fill-rule="${l.fillRule}"` : ""}/>`,
    )
    .join("");
  return `
    <svg class="tg-head__mark" viewBox="${escapeHtml(logo.viewBox ?? "0 0 24 24")}" aria-hidden="true" focusable="false">
      <path d="${escapeHtml(logo.path)}" fill="${escapeHtml(logo.color)}"${logo.fillRule ? ` fill-rule="${logo.fillRule}"` : ""}/>
      ${layers}
    </svg>
  `;
}

/** The model's name, as the panel knows it: what /import/inspect gave, else what the page shows. */
export function modelTitle(): string | null {
  const { title, url } = ctx();
  if (title) return title;
  const key = modelKey(url);
  return key ? pageTitle(key) : null;
}

/**
 * `eyebrow` says what the panel is about to do with the model; the name and picture say which model.
 *
 * The picture sits over the provider's mark rather than beside it, so one that won't load (a host that turns away
 * another page's request) simply uncovers the mark, with no script to run and nothing to measure.
 */
export function modelHeadHtml(eyebrow: string): string {
  const key = modelKey(ctx().url);
  const image = key ? pageImage(key) : null;
  const name = modelTitle();
  return `
    <div class="tg-head">
      <span class="tg-head__thumb">
        ${providerMarkHtml()}
        ${image ? `<img class="tg-head__img" src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer" />` : ""}
      </span>
      <span class="tg-head__text">
        <span class="tg-head__eyebrow">${escapeHtml(eyebrow)}</span>
        <span class="tg-head__title">${escapeHtml(name ?? "This model")}</span>
      </span>
    </div>
  `;
}
