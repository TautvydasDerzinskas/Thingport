// @ts-check

/** @param {import("../thingport").WidgetSdk} thingport */
export default function mount(thingport) {
  const { root, settings, t, labels } = thingport;
  labels();

  const panel = root.querySelector(".octo");
  const file = root.querySelector(".file");
  const bar = root.querySelector(".bar");
  const state = root.querySelector(".state");
  const address = String(settings.address).replace(/\/+$/, "");

  async function refresh() {
    try {
      // Through the Thingport server, which may reach the printer on the local network; the browser may not.
      const res = await thingport.fetch(`${address}/api/job`, { headers: { "X-Api-Key": settings.apiKey } });
      if (!res.ok) throw new Error(t("status", { status: res.status }));
      const job = await res.json();
      const done = job.progress?.completion ?? 0;
      panel.classList.remove("failed");
      file.textContent = job.job?.file?.display ?? job.job?.file?.name ?? t("idle");
      bar.setAttribute("style", `--done: ${done / 100}`);
      bar.setAttribute("aria-valuenow", String(Math.round(done)));
      const left = job.progress?.printTimeLeft;
      state.textContent = left
        ? t("left", { state: job.state, percent: Math.round(done), minutes: Math.ceil(left / 60) })
        : job.state;
    } catch (error) {
      panel.classList.add("failed");
      state.textContent = t("failed", { reason: error.message });
    }
  }

  refresh();
  const timer = setInterval(refresh, Number(settings.refresh) * 1000);
  return () => clearInterval(timer);
}
