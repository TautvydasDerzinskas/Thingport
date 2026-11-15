// Where a MakerOnline page's own picks are kept for Download adapted, which can't read the page's state: the print
// profile and model file it has picked, "<profile id>|<file id>", on <html>. background.ts writes it from the page's
// store, adaptSite.ts reads it.
export const MAKERONLINE_PICK = "data-thingport-pick";
