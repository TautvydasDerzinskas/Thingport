import { useEffect } from "react";
import { useTheme } from "@mui/material/styles";

// As big as a tab draws it on a retina screen, so the number isn't blurred by scaling down.
const ICON_SIZE = 32;
const BUBBLE_HEIGHT = 20;
const FONT_SIZE = 16;
const BUBBLE_PADDING = 3;
const BUBBLE_GAP = 2;

type BubbleStyle = { background: string; color: string; fontFamily: string };

/** Two digits can't be read at this size, and the tab's title has the exact count. */
export function faviconBadgeLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

let plainIcon: Promise<HTMLImageElement> | null = null;

function loadPlainIcon() {
  plainIcon ??= (async () => {
    const image = new Image();
    // The PNG icons have a white background, which would show as a square on a dark tab.
    image.src = "/favicon.svg";
    await image.decode();
    return image;
  })();
  return plainIcon;
}

function drawBadgedIcon(icon: HTMLImageElement, label: string, style: BubbleStyle): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(icon, 0, 0, ICON_SIZE, ICON_SIZE);

  ctx.font = `700 ${FONT_SIZE}px ${style.fontFamily}`;
  const text = ctx.measureText(label);
  const width = Math.min(ICON_SIZE, Math.max(BUBBLE_HEIGHT, text.width + BUBBLE_PADDING * 2));
  const left = ICON_SIZE - width;

  // A clear gap around the bubble keeps it apart from the icon on any tab colour.
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.roundRect(left - BUBBLE_GAP, -BUBBLE_GAP, width + BUBBLE_GAP * 2, BUBBLE_HEIGHT + BUBBLE_GAP * 2, BUBBLE_HEIGHT);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  ctx.fillStyle = style.background;
  ctx.beginPath();
  ctx.roundRect(left, 0, width, BUBBLE_HEIGHT, BUBBLE_HEIGHT / 2);
  ctx.fill();

  ctx.fillStyle = style.color;
  ctx.textAlign = "center";
  ctx.fillText(label, left + width / 2, (BUBBLE_HEIGHT + text.actualBoundingBoxAscent) / 2);
  return canvas.toDataURL("image/png");
}

/** Takes index.html's icons out while one with a bubble shows, since browsers choose among all of them. */
function showBadgedFavicon(href: string): () => void {
  const plainLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = href;
  plainLinks.forEach((plain) => plain.remove());
  document.head.append(link);
  return () => {
    link.remove();
    document.head.append(...plainLinks);
  };
}

/** An installed app has no tab to show the count on. Secure contexts only, so a plain HTTP instance goes without. */
function setAppBadge(count: number) {
  if ("setAppBadge" in navigator) navigator.setAppBadge(count).catch(() => undefined);
}

/**
 * Shows the unread count outside the page: a bubble on the tab's icon, the title, and an installed app's badge.
 * Safari doesn't redraw a changed tab icon, so the title is what its users see.
 */
export function useUnreadBadge(count: number) {
  const { palette, typography } = useTheme();
  const background = palette.error.main;
  const color = palette.error.contrastText;
  const fontFamily = typography.fontFamily ?? "sans-serif";
  const label = count > 0 ? faviconBadgeLabel(count) : null;

  useEffect(() => {
    if (count <= 0) return;
    const title = document.title;
    document.title = `(${count}) ${title}`;
    setAppBadge(count);
    return () => {
      document.title = title;
      setAppBadge(0);
    };
  }, [count]);

  useEffect(() => {
    if (!label) return;
    let restore: (() => void) | undefined;
    let cancelled = false;
    loadPlainIcon()
      .then((icon) => {
        if (cancelled) return;
        const href = drawBadgedIcon(icon, label, { background, color, fontFamily });
        if (href) restore = showBadgedFavicon(href);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      restore?.();
    };
  }, [label, background, color, fontFamily]);
}
