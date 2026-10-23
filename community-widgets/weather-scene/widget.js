const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const API = "https://api.open-meteo.com/v1/forecast";
const TWILIGHT = 50 * 60 * 1000;
const places = new Map();

// WMO weather codes, as Open-Meteo reports them.
const CODES = {
  0: ["Clear", "clear"],
  1: ["Mostly clear", "clear"],
  2: ["Partly cloudy", "partly"],
  3: ["Overcast", "overcast"],
  45: ["Fog", "fog"],
  48: ["Rime fog", "fog"],
  51: ["Light drizzle", "drizzle"],
  53: ["Drizzle", "drizzle"],
  55: ["Heavy drizzle", "drizzle"],
  56: ["Freezing drizzle", "drizzle"],
  57: ["Freezing drizzle", "drizzle"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "heavy"],
  66: ["Freezing rain", "rain"],
  67: ["Freezing rain", "heavy"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "heavysnow"],
  77: ["Snow grains", "snow"],
  80: ["Showers", "rain"],
  81: ["Showers", "rain"],
  82: ["Heavy showers", "heavy"],
  85: ["Snow showers", "snow"],
  86: ["Heavy snow showers", "heavysnow"],
  95: ["Thunderstorm", "storm"],
  96: ["Thunderstorm, hail", "storm"],
  99: ["Thunderstorm, hail", "storm"],
};
const PREVIEW = {
  clear: "Clear",
  partly: "Partly cloudy",
  overcast: "Overcast",
  rain: "Rain",
  snow: "Snow",
  storm: "Thunderstorm",
  fog: "Fog",
};

// grey: 0 blue sky, 1 grey, 2 dark grey.
const KINDS = {
  clear: { clouds: 1, grey: 0 },
  partly: { clouds: 4, grey: 0 },
  overcast: { clouds: 7, grey: 1 },
  fog: { clouds: 2, grey: 1, fog: true },
  drizzle: { clouds: 6, grey: 1, rain: 45 },
  rain: { clouds: 7, grey: 1, rain: 90 },
  heavy: { clouds: 8, grey: 2, rain: 150 },
  snow: { clouds: 6, grey: 1, snow: 50 },
  heavysnow: { clouds: 8, grey: 1, snow: 110 },
  storm: { clouds: 8, grey: 2, rain: 130, flash: true },
};

const SKY = {
  night: ["#070b1f", "#1b2550", "#2e3a6b"],
  dawn: ["#2f3c74", "#b46f8e", "#f5b47a"],
  day: ["#2f7fd6", "#6fb2ec", "#bfe1fa"],
  dusk: ["#241f4f", "#a14a6b", "#f08a5d"],
};
const GREY = {
  night: ["#0e1119", "#1b202b", "#2a303c"],
  dawn: ["#4b5062", "#7d7680", "#b0998c"],
  day: ["#6c7a89", "#95a1ae", "#c1c9d2"],
  dusk: ["#383645", "#6a5964", "#9a7a72"],
};
const CLOUD = {
  night: ["#3b4358", "#2b303b", "#1f232b"],
  dawn: ["#f7cdbb", "#9d8c92", "#6d6670"],
  day: ["#ffffff", "#dfe4ea", "#8b939f"],
  dusk: ["#f2b5a0", "#8e7c86", "#5f5862"],
};
// Far hill, near hill, tree crown (none: bare).
const GROUND = {
  spring: ["#86c96f", "#5fae52", "#8fd47a"],
  summer: ["#55a043", "#3d8332", "#2f7a2a"],
  autumn: ["#c98f3e", "#a66b2d", "#e0752d"],
  winter: ["#9ea88c", "#7f8a70", null],
  snow: ["#eef3f7", "#d3dde6", null],
};
const LEAVES = { spring: ["#f7b7cc", "#fbd3e0", "#ffffff"], autumn: ["#e0752d", "#c9542a", "#e9a93b", "#a8442a"] };

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const f = (n, d = 1) => n.toFixed(d);
const repeat = (n, fn) => Array.from({ length: Math.round(n) }, (_, i) => fn(i)).join("");

async function locate(fetch, query) {
  const coords = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) return { lat: Number(coords[1]), lon: Number(coords[2]), name: "" };
  const key = query.trim().toLowerCase();
  if (!places.has(key)) {
    const res = await fetch(`${GEO}?name=${encodeURIComponent(query.trim())}&count=1&format=json`);
    if (!res.ok) throw new Error("geocoding");
    const hit = (await res.json()).results?.[0];
    if (!hit) throw new Error("notfound");
    places.set(key, { lat: hit.latitude, lon: hit.longitude, name: hit.name });
  }
  return places.get(key);
}

// Sunrises and sunsets around now, as epoch ms. Open-Meteo gives them in the location's local time.
function sunEvents(data, off) {
  const events = [];
  if (data) {
    const toMs = (s) => Date.parse(`${s}Z`) - off;
    data.daily.time.forEach((_, i) => {
      if (data.daily.sunrise[i]) events.push({ up: true, t: toMs(data.daily.sunrise[i]) });
      if (data.daily.sunset[i]) events.push({ up: false, t: toMs(data.daily.sunset[i]) });
    });
  } else {
    const local = new Date(Date.now() + off);
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off;
    for (const d of [-1, 0, 1]) {
      events.push(
        { up: true, t: midnight + (d * 24 + 7) * 3600e3 },
        { up: false, t: midnight + (d * 24 + 19) * 3600e3 },
      );
    }
  }
  return events.toSorted((a, b) => a.t - b.t);
}

function sunState(events, now, isDay) {
  const i = events.findLastIndex((e) => e.t <= now);
  const prev = events[i];
  const next = events[i + 1];
  if (!prev || !next) return { up: isDay, phase: isDay ? "day" : "night", progress: 0.5 };
  const near = [prev, next]
    .filter((e) => Math.abs(now - e.t) < TWILIGHT)
    .toSorted((a, b) => Math.abs(now - a.t) - Math.abs(now - b.t))[0];
  return {
    up: prev.up,
    phase: near ? (near.up ? "dawn" : "dusk") : prev.up ? "day" : "night",
    progress: (now - prev.t) / (next.t - prev.t),
  };
}

const TIME_PREVIEW = {
  dawn: { up: true, phase: "dawn", progress: 0.04 },
  day: { up: true, phase: "day", progress: 0.42 },
  dusk: { up: true, phase: "dusk", progress: 0.96 },
  night: { up: false, phase: "night", progress: 0.4 },
};

function seasonOf(month, lat) {
  const m = lat < 0 ? (month + 6) % 12 : month;
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

// 0 new moon, 0.5 full.
const moonAge = (now) => ((((now - Date.UTC(2000, 0, 6, 18, 14)) / 86400000 / 29.530588) % 1) + 1) % 1;

function moonMask(age) {
  const lit = (1 - Math.cos(2 * Math.PI * age)) / 2;
  const shift = lit * 110;
  const cx = age < 0.5 ? 50 - shift : 50 + shift;
  const r = "calc(var(--u) * 8)";
  const mask = `radial-gradient(circle ${r} at ${f(cx)}% 50%, transparent calc(${r} - 0.5px), #000 ${r})`;
  return `-webkit-mask:${mask};mask:${mask}`;
}

export default function mount(thingport) {
  const { root, settings, theme } = thingport;
  const q = (c) => root.querySelector(c);
  const wx = q(".wx");
  const layer = {
    sky: q(".wx-sky"),
    stars: q(".wx-stars"),
    body: q(".wx-body"),
    clouds: q(".wx-clouds"),
    ground: q(".wx-ground"),
    shade: q(".wx-shade"),
    precip: q(".wx-precip"),
    fog: q(".wx-fog"),
    storm: q(".wx-storm"),
  };
  const text = { temp: q(".wx-temp"), desc: q(".wx-desc"), place: q(".wx-place"), extra: q(".wx-extra") };
  const imperial = settings.units === "imperial";
  wx.style.fontFamily = theme.fontFamily;

  let size = thingport.size;
  let data = null;
  let place = null;
  let sceneKey = "";
  let stopped = false;

  function fit(next) {
    size = next;
    wx.style.setProperty("--u", `${Math.min(next.width, next.height) / 100}px`);
    wx.classList.toggle("small", next.width < 240 || next.height < 150);
  }
  fit(size);
  const stopResize = thingport.onResize(fit);

  function scene(now = Date.now()) {
    const cur = data?.current;
    const off = (data ? data.utc_offset_seconds : -new Date().getTimezoneOffset() * 60) * 1000;
    const lat = data?.latitude ?? place?.lat ?? 50;
    const sun = TIME_PREVIEW[settings.time] ?? sunState(sunEvents(data, off), now, cur ? cur.is_day === 1 : true);
    const kind = PREVIEW[settings.scene] ? settings.scene : (CODES[cur?.weather_code]?.[1] ?? "partly");
    const tempC = cur ? (imperial ? ((cur.temperature_2m - 32) * 5) / 9 : cur.temperature_2m) : 10;
    const windKmh = cur ? (imperial ? cur.wind_speed_10m * 1.609 : cur.wind_speed_10m) : 8;
    const season = settings.season !== "auto" ? settings.season : seasonOf(new Date(now + off).getUTCMonth(), lat);
    const k = KINDS[kind];
    const snowy = Boolean(k.snow) || (season === "winter" && tempC <= 1 && settings.season === "auto");
    return { ...sun, kind, k, season, snowy, windKmh, moon: moonAge(now) };
  }

  function placeBody(s) {
    const p = clamp(s.progress, 0, 1);
    layer.body.style.left = `${f(6 + p * 88)}%`;
    layer.body.style.top = `${f(64 - Math.sin(p * Math.PI) * 50)}%`;
  }

  function build(s) {
    const r = rng(7);
    const { k, phase } = s;
    const twilight = phase === "dawn" || phase === "dusk";
    const area = clamp((size.width * size.height) / 90000, 0.5, 2);

    const sky = (k.grey ? GREY : SKY)[phase];
    layer.sky.style.background = `linear-gradient(${sky[0]}, ${sky[1]} 55%, ${sky[2]})`;

    const starAlpha = k.grey ? 0 : phase === "night" ? 1 : twilight ? 0.3 : 0;
    layer.stars.style.opacity = starAlpha;
    layer.stars.innerHTML = starAlpha
      ? repeat(
          45 * area,
          () =>
            `<i class="wx-star" style="left:${f(r() * 100)}%;top:${f(r() * 62)}%;transform:scale(${f(0.6 + r(), 2)});animation-duration:${f(2 + r() * 3)}s;animation-delay:-${f(r() * 4)}s"></i>`,
        )
      : "";

    layer.body.className = `wx-body${twilight ? " low" : ""}`;
    layer.body.innerHTML = s.up
      ? `<div class="wx-rays"></div><div class="wx-sun"></div>`
      : `<div class="wx-moonbase"></div><div class="wx-moonglow"><div class="wx-moon" style="${moonMask(s.moon)}"></div></div>`;
    layer.body.style.opacity = k.fog ? 0.5 : k.grey ? (k.clouds >= 7 ? 0.25 : 0.4) : 1;
    placeBody(s);

    wx.style.setProperty("--cc", CLOUD[phase][k.grey]);
    const speed = 1 + Math.min(s.windKmh, 60) / 15;
    layer.clouds.innerHTML =
      (k.grey ? `<div class="wx-blanket"></div>` : "") +
      repeat(k.clouds, () => {
        const dur = (80 + r() * 70) / speed;
        return `<div class="wx-track" style="--w:calc(var(--u) * ${f(26 + r() * 26)});top:${f(5 + r() * 36)}%;animation-duration:${f(dur)}s;animation-delay:-${f(r() * dur)}s"><div class="wx-cloud" style="opacity:${f(0.75 + r() * 0.25, 2)}"></div></div>`;
      });

    const g = GROUND[s.snowy ? "snow" : s.season];
    const crown = s.snowy && s.season !== "winter" ? GROUND[s.season][2] : g[2];
    const dimmed = k.grey ? 0.85 : 1;
    layer.ground.style.cssText = `--g1:${g[0]};--g2:${g[1]};--crown:${crown};--gb:${(phase === "night" ? 0.38 : twilight ? 0.72 : 1) * dimmed};--gs:${phase === "night" ? 0.6 : 1}`;
    const tree = crown
      ? `<div class="wx-trunk"></div><div class="wx-crown${s.season === "spring" ? " blossom" : ""}${s.snowy ? " snowy" : ""}"></div>`
      : `<div class="wx-trunk"></div><div class="wx-branch b1"></div><div class="wx-branch b2"></div><div class="wx-branch b3"></div>`;
    const flowers =
      s.season === "spring" && !s.snowy
        ? repeat(
            14 * area,
            () =>
              `<i class="wx-flower" style="left:${f(r() * 100)}%;bottom:${f(2 + r() * 12)}%;background:${["#ffffff", "#ffe066", "#f7a8c4"][Math.floor(r() * 3)]}"></i>`,
          )
        : "";
    layer.ground.innerHTML = `<div class="wx-hill far"></div><div class="wx-hill near"></div>${flowers}<div class="wx-tree${crown ? "" : " bare"}" style="--sw:${f(0.6 + Math.min(s.windKmh, 70) / 12)}deg">${tree}</div>`;

    // A faint scrim at the top keeps the text readable over pale clouds.
    const scrim = "linear-gradient(rgba(0, 0, 0, 0.18), transparent 50%)";
    layer.shade.style.background = k.grey === 2 ? `${scrim}, rgba(8, 12, 24, 0.28)` : scrim;

    layer.precip.style.setProperty("--tilt", `${f(clamp(s.windKmh / 2, 0, 22))}deg`);
    let precip = "";
    if (k.rain) {
      precip = repeat(k.rain * area, () => {
        const dur = 0.45 + r() * 0.35;
        return `<i class="wx-fall wx-drop" style="left:${f(r() * 100)}%;animation-duration:${f(dur, 2)}s;animation-delay:-${f(r() * dur, 2)}s"><b></b></i>`;
      });
    } else if (k.snow) {
      precip = repeat(k.snow * area, () => {
        const dur = 5 + r() * 6;
        return `<i class="wx-fall wx-flake" style="left:${f(r() * 100)}%;--s:${f(2 + r() * 3)}px;opacity:${f(0.6 + r() * 0.4, 2)};animation-duration:${f(dur)}s;animation-delay:-${f(r() * dur)}s"><b style="animation-delay:-${f(r() * 3)}s"></b></i>`;
      });
    } else if (LEAVES[s.season] && phase !== "night" && !s.snowy) {
      const colors = LEAVES[s.season];
      precip = repeat((s.season === "autumn" ? 10 : 7) * area, () => {
        const dur = 7 + r() * 6;
        return `<i class="wx-fall wx-leaf" style="left:${f(r() * 100)}%;--s:calc(var(--u) * ${f(2 + r() * 2)});--c:${colors[Math.floor(r() * colors.length)]};animation-duration:${f(dur)}s;animation-delay:-${f(r() * dur)}s"><b style="animation-duration:${f(3 + r() * 3)}s"></b></i>`;
      });
    }
    if (s.season === "summer" && phase === "night" && !k.rain) {
      precip += repeat(
        10 * area,
        () =>
          `<i class="wx-fly" style="left:${f(15 + r() * 75)}%;top:${f(68 + r() * 18)}%;animation-delay:-${f(r() * 3)}s,-${f(r() * 7)}s"></i>`,
      );
    }
    layer.precip.innerHTML = precip;

    layer.fog.innerHTML = k.fog
      ? repeat(
          3,
          (i) =>
            `<div class="wx-fogband" style="top:${30 + i * 22}%;animation-duration:${20 + i * 9}s;animation-delay:-${i * 7}s"></div>`,
        )
      : "";
    layer.storm.innerHTML = k.flash
      ? `<div class="wx-flash"></div><svg class="wx-bolt" viewBox="0 0 20 40" aria-hidden="true"><path d="M12 0 3 22h7L6 40l12-26h-7z" fill="#fffbe0"/></svg>`
      : "";
  }

  function draw() {
    const s = scene();
    const key = [s.kind, s.phase, s.up, s.season, s.snowy, size.width > 0].join("|");
    if (key === sceneKey) placeBody(s);
    else {
      sceneKey = key;
      build(s);
    }
  }

  function showText(message) {
    const cur = data?.current;
    if (!cur) {
      text.temp.textContent = "–";
      text.desc.textContent = message;
      text.place.textContent = "";
      text.extra.textContent = "";
      return;
    }
    const deg = (v) => `${Math.round(v)}°`;
    text.temp.textContent = deg(cur.temperature_2m);
    text.desc.textContent = PREVIEW[settings.scene] ?? CODES[cur.weather_code]?.[0] ?? "";
    const name = settings.label?.trim() || place?.name || "";
    const hi = data.daily.temperature_2m_max?.[1];
    const lo = data.daily.temperature_2m_min?.[1];
    text.place.textContent = [name, hi != null && lo != null ? `H ${deg(hi)} L ${deg(lo)}` : ""]
      .filter(Boolean)
      .join(" · ");
    text.extra.innerHTML = "";
    if (settings.details) {
      for (const line of [
        `Feels ${deg(cur.apparent_temperature)}`,
        `Wind ${Math.round(cur.wind_speed_10m)} ${data.current_units.wind_speed_10m}`,
        `Humidity ${cur.relative_humidity_2m}%`,
      ]) {
        const div = document.createElement("div");
        div.textContent = line;
        text.extra.append(div);
      }
    }
  }

  async function refresh() {
    try {
      place = await locate(thingport.fetch, settings.location || "Vilnius");
      const params = new URLSearchParams({
        latitude: place.lat,
        longitude: place.lon,
        current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m",
        daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
        timezone: "auto",
        past_days: "1",
        forecast_days: "2",
        temperature_unit: imperial ? "fahrenheit" : "celsius",
        wind_speed_unit: imperial ? "mph" : "kmh",
      });
      const res = await thingport.fetch(`${API}?${params}`);
      if (!res.ok) throw new Error("forecast");
      const next = await res.json();
      if (stopped) return;
      data = next;
      showText();
    } catch (err) {
      if (stopped) return;
      if (!data) showText(err.message === "notfound" ? "Location not found" : "Couldn't load weather");
    }
    draw();
  }

  draw();
  refresh();
  const poll = setInterval(refresh, Number(settings.refresh || 30) * 60 * 1000);
  const clock = setInterval(draw, 60 * 1000);
  return () => {
    stopped = true;
    clearInterval(poll);
    clearInterval(clock);
    stopResize();
  };
}
