// The floating icon's pull toward the pointer: within reach it leans and stretches toward it like something sticky,
// and springs back when the pointer leaves (the motion itself is CSS, in _fab.scss). On April Fools' it dodges
// instead, squashed as if flinching; right over it, it's caught. Mouse only, and off for anyone who asked for less
// motion.

const REACH_PX = 140;
const PULL = 0.6;
const MAX_STRETCH = 0.3;

/** `body` is what moves; `button` stays put, so measuring it doesn't chase its own pull. */
export function attachMagnet(
  button: HTMLElement,
  body: HTMLElement,
  { paused, dodges }: { paused: () => boolean; dodges: () => boolean },
): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  let near = false;

  const release = () => {
    if (!near) return;
    near = false;
    button.classList.remove("tg-fab--near");
    body.style.setProperty("--tg-x", "0px");
    body.style.setProperty("--tg-y", "0px");
    body.style.setProperty("--tg-stretch", "0");
  };

  const update = () => {
    frame = 0;
    if (!pointer || paused()) return release();
    const rect = button.getBoundingClientRect();
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > REACH_PX) return release();
    // Smoothstep: no pull at the edge of reach, strongest about halfway in, and settled right under the pointer.
    const t = 1 - distance / REACH_PX;
    const ease = t * t * (3 - 2 * t);
    near = true;
    button.classList.add("tg-fab--near");
    const away = dodges() ? -1 : 1;
    body.style.setProperty("--tg-x", `${away * dx * PULL * ease}px`);
    body.style.setProperty("--tg-y", `${away * dy * PULL * ease}px`);
    // Reaching out stretches it most; once the pointer is on it, it rounds out again. Dodging squashes it instead.
    body.style.setProperty("--tg-stretch", String(away * MAX_STRETCH * ease * Math.min(distance / 60, 1)));
    body.style.setProperty("--tg-angle", `${Math.atan2(dy, dx)}rad`);
  };

  const onMove = (event: PointerEvent) => {
    // Gone with the rest of the page's Grab UI: stop listening.
    if (!button.isConnected) {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      return;
    }
    if (event.pointerType !== "mouse") return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(update);
  };
  const onLeave = () => {
    pointer = null;
    release();
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
}
