// Preloaded into the backend by docker-compose.yml: answers what a MakerWorld import asks for from inside the process, so
// a link imports with no network and no real account. Every other request goes out as usual.
//
// The first digit of the model's id says how it behaves, so a test only has to pick the link:
//   1  imports at once
//   2  holds back its file until a file named after the model appears in FAKE_PROVIDER_GATES, which keeps the line still
//   3  breaks off partway through its file, so the import fails
//
// It's the file's content that waits or breaks, never the answer: the web app inspects a MakerWorld link when it's
// submitted, which reads that far and no further, so the link still gets into the line.
const dns = require("node:dns/promises");
const fs = require("node:fs");
const path = require("node:path");

const HOSTS = new Set(["makerworld.com", "api.bambulab.com", "files.regression.test"]);
const GATES = process.env.FAKE_PROVIDER_GATES;
// A test that died before letting go. The import has given up on a silent download by then.
const HOLD_LIMIT_MS = 120_000;
const CUBE = fs.readFileSync(path.join(__dirname, "cube.stl"));
const DESIGNER = { uid: 1000001, name: "Regression Designer" };

// Imports refuse a host that doesn't resolve, or resolves to a private address.
const { resolve4, resolve6 } = dns;
dns.resolve4 = (host, ...rest) => (HOSTS.has(host) ? Promise.resolve(["93.184.216.34"]) : resolve4(host, ...rest));
dns.resolve6 = (host, ...rest) => (HOSTS.has(host) ? Promise.reject(new Error("no AAAA")) : resolve6(host, ...rest));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function letGo(id) {
  const deadline = Date.now() + HOLD_LIMIT_MS;
  while (GATES && !fs.existsSync(path.join(GATES, id)) && Date.now() < deadline) await sleep(100);
}

const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

// Each model's only profile has the model's id, which is how the id reaches the file's address.
const design = (id) => ({
  id: Number(id),
  modelId: `US${id}`,
  title: `Regression model ${id}`,
  summary: "<p>From the regression pack's fake provider.</p>",
  tags: ["regression"],
  designCreator: DESIGNER,
  defaultInstanceId: 1,
  instances: [{ id: 1, profileId: Number(id), title: "Default", instanceCreator: DESIGNER }],
});

function file(id) {
  const body = new ReadableStream(
    {
      async pull(controller) {
        if (id.startsWith("3")) {
          controller.error(new TypeError("terminated"));
          return;
        }
        if (id.startsWith("2")) await letGo(id);
        controller.enqueue(new Uint8Array(CUBE));
        controller.close();
      },
    },
    // Only once something reads it.
    { highWaterMark: 0 },
  );
  return new Response(body, { headers: { "content-type": "application/octet-stream" } });
}

function answer({ hostname, pathname }) {
  const model = pathname.match(/^\/v1\/design-service\/design\/(\d+)/);
  if (hostname === "api.bambulab.com" && model) return json(design(model[1]));
  const profile = pathname.match(/^\/v1\/iot-service\/api\/user\/profile\/(\d+)/);
  if (hostname === "api.bambulab.com" && profile) {
    return json({
      message: "success",
      url: `https://files.regression.test/${profile[1]}/cube.stl`,
      filename: `cube-${profile[1]}.stl`,
    });
  }
  const content = pathname.match(/^\/(\d+)\/cube\.stl$/);
  if (hostname === "files.regression.test" && content) return file(content[1]);
  return new Response("not found", { status: 404 });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return HOSTS.has(url.hostname) ? answer(url) : realFetch(input, init);
};
