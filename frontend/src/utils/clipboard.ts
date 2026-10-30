// navigator.clipboard only exists in secure contexts (HTTPS or localhost), and self-hosted instances are often plain
// HTTP on a LAN, so there this falls back to the copy command, which works on any origin. Call it straight from the
// click or key press: browsers only let a page copy in answer to one.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Turned down (no permission, or the page lost focus): the copy command may still be allowed.
    }
  }
  if (!copyWithCommand(text)) throw new Error("The browser didn't allow copying");
}

/** The text is both handed to the copy event and selected in an off-screen node, since browsers differ on which a
 *  copy with nothing selected uses. The selection is put back after, and focus never moves (a dialog's focus trap
 *  would take it back). */
function copyWithCommand(text: string): boolean {
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  };
  const node = document.createElement("span");
  node.textContent = text;
  node.setAttribute("aria-hidden", "true");
  Object.assign(node.style, { position: "fixed", top: "0", left: "-9999px", whiteSpace: "pre", userSelect: "text" });
  const selection = document.getSelection();
  const previous = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];
  document.body.append(node);
  document.addEventListener("copy", onCopy);
  try {
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy);
    node.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of previous) selection.addRange(range);
    }
  }
}
