// The dashboard's CPU and server uptime panels: the machine Thingport runs on, as Node sees it. In a container
// that's the host's CPUs and memory.

import os from "node:os";

// Long enough for a steady reading, short enough not to hold the request up.
const SAMPLE_MS = 250;
// Several dashboards open at once share one reading.
const CACHE_MS = 2000;

export type SystemStats = {
  cpu: {
    /** Busy share of all cores over a short sample, 0-100. */
    usage: number;
    cores: number;
    model: string | null;
    /** 1, 5 and 15 minutes; zeros on Windows, which has no load average. */
    load: [number, number, number];
  };
  memory: { total: number; used: number };
  uptime: { thingport: number; host: number };
};

let cached: { at: number; value: Promise<SystemStats> } | null = null;

function cpuTimes(): { idle: number; total: number } {
  return os.cpus().reduce(
    (sum, cpu) => {
      const { idle, user, nice, sys, irq } = cpu.times;
      return { idle: sum.idle + idle, total: sum.total + idle + user + nice + sys + irq };
    },
    { idle: 0, total: 0 },
  );
}

async function measure(): Promise<SystemStats> {
  const before = cpuTimes();
  await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  const after = cpuTimes();
  const total = after.total - before.total;
  const usage = total > 0 ? Math.round((1 - (after.idle - before.idle) / total) * 1000) / 10 : 0;
  const cpus = os.cpus();
  const [one, five, fifteen] = os.loadavg();
  return {
    cpu: {
      usage: Math.max(0, Math.min(100, usage)),
      cores: cpus.length,
      model: cpus[0]?.model.trim() || null,
      load: [one, five, fifteen].map((value) => Math.round(value * 100) / 100) as [number, number, number],
    },
    memory: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
    uptime: { thingport: Math.round(process.uptime()), host: Math.round(os.uptime()) },
  };
}

export function getSystemStats(): Promise<SystemStats> {
  if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), value: measure() };
  return cached.value;
}
