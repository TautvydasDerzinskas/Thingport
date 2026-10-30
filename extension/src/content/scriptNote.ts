// What a model's generator script means for the import, said under the floating icon.
//
// A model built from a script comes in one of two kinds. Its creator either published the script, in which case
// it comes along and the model can be generated again in Thingport with other values; or they kept it, in which
// case the model still imports and prints but can never be customised. Which of the two it is decides whether
// this is the import someone wanted, so the icon says it before anyone opens the panel, and the panel says it
// again in words for anyone who missed it.
//
// The faces are drawn rather than assembled out of boxes: they sit beside an icon with twenty-three hand-drawn
// seasonal editions, and anything cruder reads as a placeholder. Their colours come from the palette
// (styles/_tokens.scss) so they follow light and dark; their movement is in _fab-note.scss, with the rest of
// the line's, so one reduced-motion rule covers all of it.

// A sentence each for the card above the panel, where there is room for a line but not a paragraph: the
// tooltip under the icon still carries the longer version for anyone who wants it.
export const SHARED_SCRIPT_SHORT = "The author allows it, so the script comes with the model.";
export const WITHHELD_SCRIPT_SHORT = "The author chose not to share the script, so it can't be imported.";

export const SHARED_SCRIPT_EXPLAINER =
  "This model was generated from a script, and its creator shared it — so the script comes along, and you can " +
  "generate the model again with your own values.";

export const WITHHELD_SCRIPT_EXPLAINER =
  "This model was generated from a script, but its creator chose not to share it, so the script can't be " +
  "imported. The model itself comes over as usual — only customising it again isn't possible.";

/** Brows lifted at their inner ends, which is the whole of the sadness; the mouth only agrees with them. */
const SAD_FACE = `
<svg class="tg-face" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
  <g class="tg-face__head">
    <circle cx="12" cy="12" r="9.1" fill="var(--tg-danger-soft)" stroke="var(--tg-danger)" stroke-width="1.5"/>
    <g fill="none" stroke="var(--tg-danger)" stroke-width="1.5" stroke-linecap="round">
      <path d="M6.1 9.5Q8.2 7.7 10.2 8.1"/>
      <path d="M17.9 9.5Q15.8 7.7 13.8 8.1"/>
      <path d="M8.7 17.5Q12 14.7 15.3 17.5"/>
    </g>
    <g class="tg-face__eyes" fill="var(--tg-danger)">
      <circle cx="8.9" cy="12.3" r="1.6"/>
      <circle cx="15.1" cy="12.3" r="1.6"/>
      <circle cx="8.35" cy="11.75" r="0.52" fill="var(--tg-surface)"/>
      <circle cx="14.55" cy="11.75" r="0.52" fill="var(--tg-surface)"/>
    </g>
  </g>
  <path class="tg-face__tear" d="M8.9 14.4q1.5 2 0 2.9q-1.5-0.9 0-2.9Z" fill="var(--tg-danger)" opacity="0.55"/>
</svg>
`;

/**
 * The glad one. Brows lifted together rather than at their inner ends, a wide mouth, and cheeks pushed up
 * under the eyes -- which is what a real smile does, and what tells it from a polite one.
 *
 * The eyes are two pairs: open ones, and the happy arcs it squeezes into at the top of each bounce. Swapping
 * between them is a step animation, so it reads as a change of expression rather than a morph.
 */
const HAPPY_FACE = `
<svg class="tg-face tg-face--happy" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
  <g class="tg-face__head">
    <circle cx="12" cy="12" r="9.1" fill="var(--tg-accent-soft)" stroke="var(--tg-accent)" stroke-width="1.5"/>
    <g fill="none" stroke="var(--tg-accent)" stroke-width="1.5" stroke-linecap="round">
      <path d="M6.3 8.4Q8.3 7.1 10.3 8.0"/>
      <path d="M17.7 8.4Q15.7 7.1 13.7 8.0"/>
      <!-- Open all the way to the corners, where it turns up. -->
      <path class="tg-face__smile" d="M7.5 14.4Q12 19.4 16.5 14.4"/>
    </g>
    <g class="tg-face__eyes" fill="var(--tg-accent)">
      <circle cx="8.9" cy="11.9" r="1.6"/>
      <circle cx="15.1" cy="11.9" r="1.6"/>
      <circle cx="8.35" cy="11.35" r="0.52" fill="var(--tg-surface)"/>
      <circle cx="14.55" cy="11.35" r="0.52" fill="var(--tg-surface)"/>
    </g>
    <g class="tg-face__squint" fill="none" stroke="var(--tg-accent)" stroke-width="1.6" stroke-linecap="round">
      <path d="M7.4 12.2Q8.9 10.4 10.4 12.2"/>
      <path d="M13.6 12.2Q15.1 10.4 16.6 12.2"/>
    </g>
  </g>
  <!-- A spark that pops off the top corner at the height of the bounce. -->
  <path class="tg-face__spark" d="M20 3.1l0.75 1.95 1.95 0.75-1.95 0.75-0.75 1.95-0.75-1.95-1.95-0.75 1.95-0.75Z"
        fill="var(--tg-accent)"/>
</svg>
`;

// The two lines. The withheld one leads with a red "No" against the plain name of the thing it hasn't got;
// the shared one is the name alone, in green, with the exclamation doing the work the "No" does on the other.
export const WITHHELD_SCRIPT_NOTE_HTML = `
  ${SAD_FACE}
  <span aria-hidden="true"><span class="tg-fab-note__no">No</span> <span class="tg-fab-note__label">SCAD</span></span>
  <span class="tg-visually-hidden">No SCAD. ${WITHHELD_SCRIPT_EXPLAINER}</span>
`;

export const SHARED_SCRIPT_NOTE_HTML = `
  ${HAPPY_FACE}
  <span class="tg-fab-note__yes" aria-hidden="true">SCAD!</span>
  <span class="tg-visually-hidden">SCAD included. ${SHARED_SCRIPT_EXPLAINER}</span>
`;

/** The card above the panel: the same face and word as the line under the icon, and a sentence of why. */
const panelNote = (face: string, lead: string, text: string) => `
  <div class="tg-panel-note__face">${face}</div>
  <div class="tg-panel-note__text"><span class="tg-panel-note__lead">${lead}</span> ${text}</div>
`;

export const WITHHELD_SCRIPT_PANEL_NOTE_HTML = panelNote(SAD_FACE, "No SCAD.", WITHHELD_SCRIPT_SHORT);

export const SHARED_SCRIPT_PANEL_NOTE_HTML = panelNote(HAPPY_FACE, "SCAD!", SHARED_SCRIPT_SHORT);
