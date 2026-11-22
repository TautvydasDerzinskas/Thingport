export const prusa = (article) => "https://help.prusa3d.com/article/" + article;
export const printQuality = "https://help.prusa3d.com/category/print-quality-troubleshooting_225";

export function reference(section, id, title, summary, blocks, related, sources) {
  return { section, id, title, summary, blocks, related, sources };
}

export const guide = (...args) => reference("Guides", ...args);
