const UNITS = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1_000],
];

export default function mount(thingport) {
  const { root, selector, settings, theme } = thingport;
  root.innerHTML = `
    <style>
      ${selector} .countdown { height: 100%; display: flex; flex-direction: column; justify-content: center;
        gap: 4px; padding: 12px 16px; box-sizing: border-box; font-family: ${theme.fontFamily}; }
      ${selector} .left { font-size: 28px; font-weight: 600; color: ${theme.text}; font-variant-numeric: tabular-nums; }
      ${selector} .title { color: ${theme.textSecondary}; font-size: 14px; }
      ${selector} .compact .left { font-size: 20px; }
    </style>
    <div class="countdown">
      <div class="left"></div>
      <div class="title"></div>
    </div>`;
  const box = root.querySelector(".countdown");
  const left = root.querySelector(".left");
  root.querySelector(".title").textContent = settings.title;

  const target = new Date(settings.date).getTime();
  const units = settings.showSeconds ? UNITS : UNITS.slice(0, 3);
  const tick = () => {
    if (Number.isNaN(target)) {
      left.textContent = "Set a date";
      return;
    }
    let rest = Math.max(0, target - Date.now());
    left.textContent = units
      .map(([unit, ms]) => {
        const value = Math.floor(rest / ms);
        rest -= value * ms;
        return `${value}${unit}`;
      })
      .join(" ");
  };
  tick();
  const timer = setInterval(tick, settings.showSeconds ? 1_000 : 30_000);

  const fit = ({ width }) => box.classList.toggle("compact", width < 220);
  fit(thingport.size);
  const stopResize = thingport.onResize(fit);
  return () => {
    clearInterval(timer);
    stopResize();
  };
}
