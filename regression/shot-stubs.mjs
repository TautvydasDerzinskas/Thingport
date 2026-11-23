// What the README, site and What's new screenshots show that a library seldom has, answered in the browser so nothing
// is saved on the instance: a model's README, parts list and assembly guide, and a household's Send to places.

// A model's supporting files: few libraries have a README, a parts list and an assembly guide beside the same model,
// and the shots want all of them. The README and the parts list open in the viewer; the others are only listed. They're
// written for MakerWorld's Cute Wobbly Penguin, the model the shots are taken with.
const README = `# Cute Wobbly Penguin

A self-righting wobble toy: knock it over and it rocks back up.

## What you need

- The printed parts, listed in **Parts list.csv**
- A dab of super glue for the eyes and the beak

## Assembly

1. Press the four **connectors** into the lower body.
2. Push the top body down onto them until it clicks.
3. Slide the **belly** panel into its recess.
4. Glue on the **eyes** and the **beak**.

> Print the lower body with 100% infill: its weight is what stands the penguin back up.

## Print settings

| Part | Layer height | Walls | Infill |
| --- | --- | --- | --- |
| Top body | 0.2 mm | 3 | 15% |
| Lower body | 0.2 mm | 3 | 100% |
| Belly, eyes, beak | 0.16 mm | 2 | 15% |
`;
const PARTS = `Part,Plate,Colour,Quantity,Notes
Top body,Body,Blue,1,
Lower body,Body,Blue,1,100% infill for the weight
Connector,Body,Blue,4,
Belly,Belly,White,1,
Eyes,Eyes,Black,2,Glue in place
Beak,Beak,Orange,1,Glue in place
`;

export async function stubSupportingFiles(page, id) {
  const caps = (view) => ({ preview3d: false, openInSlicer: false, openInStudio: false, customize: false, view });
  const file = (fileId, filename, folder, mime, size, kind, view) => ({
    id: fileId,
    filename,
    folder,
    mime,
    size,
    url: `/print/${id}/files/${fileId}`,
    content_kind: kind,
    caps: caps(view),
  });
  const files = [
    file("shotreadme", "README.md", null, "text/markdown", README.length, "document", "markdown"),
    file("shotguide", "Assembly guide.pdf", "Instructions", "application/pdf", 2481664, "document", "pdf"),
    file("shotparts", "Parts list.csv", "Instructions", "text/csv", PARTS.length, "document", "table"),
    file("shotsource", "Wobbly Penguin.f3d", "Source", "application/octet-stream", 4218880, "cad", null),
  ];
  const withFiles = async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.supporting_files = files;
    if ("supporting_file_count" in body) body.supporting_file_count = files.length;
    await route.fulfill({ response: res, json: body });
  };
  await page.route(new RegExp(`/api/print/${id}(/files)?(\\?.*)?$`), withFiles);
  await page.route(/\/api\/print\/[^/]+\/files\/shot(readme|guide|parts|source)/, (route) => {
    const url = route.request().url();
    const text = url.includes("shotreadme") ? README : url.includes("shotparts") ? PARTS : null;
    return text === null
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ contentType: "text/plain; charset=utf-8", body: text });
  });
}

// Send to places like a household's: two printers and two webhooks.
const SEND_TARGETS = [
  ["shot-octoprint", "Workshop OctoPrint", "button", ["gcode"], "octoprint", "http://octopi.local", true],
  ["shot-klipper", "Voron 2.4", "menu", ["gcode"], "moonraker", "http://voron.local:7125", false],
  [
    "shot-ha",
    "Home Assistant",
    "menu",
    ["3mf", "gcode"],
    "homeassistant",
    "http://homeassistant.local:8123/api/webhook/thingport-print",
    false,
  ],
  ["shot-n8n", "Print log (n8n)", "menu", ["3mf", "stl", "gcode"], "n8n", "http://n8n.local:5678/webhook/print", false],
].map(([id, name, placement, types, preset, address, apiKey]) => ({
  id,
  name,
  placement,
  file_types: types,
  how: { type: "preset", preset, address, start: false },
  secrets: { api_key: apiKey, headers: [] },
}));

export async function stubSendTargets(page) {
  await page.route(/\/api\/me\/send-targets(\?.*)?$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { targets: SEND_TARGETS } }) : route.fallback(),
  );
}
