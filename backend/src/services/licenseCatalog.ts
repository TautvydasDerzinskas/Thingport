// The licences Thingport knows, what each lets someone do with a model, and the helpers providers read their sites'
// licences with. A site licence gets an id of its own; a standard one keeps its SPDX id. What a licence allows is
// read off its own text, and where that's unclear it counts as not allowed, so the "Licence allows" filter never
// lists a model the licence may not cover.

/** What a licence may allow: pass the files on unchanged, change them, use them (and prints of them) commercially. */
export const LICENSE_ACTIONS = ["share", "remix", "commercial"] as const;
export type LicenseAction = (typeof LICENSE_ACTIONS)[number];

/** cc, by, nc, sa, nd: Creative Commons' marks; zero: CC0; pd: the public domain mark. */
export type LicenseMark = "cc" | "by" | "nc" | "sa" | "nd" | "zero" | "pd";
/** cc: Creative Commons and the public domain; open: an open-source licence; site: a model site's own; reserved: none. */
export type LicenseFamily = "cc" | "open" | "site" | "reserved";

export type LicenseDef = {
  id: string;
  short: string;
  name: string;
  url: string | null;
  family: LicenseFamily;
  marks: LicenseMark[];
  allows: LicenseAction[];
  /** Credit the creator; remixes under the same licence. */
  requires: { credit: boolean; sameLicense: boolean };
  /** What a site licence says, for one whose site doesn't send its text with each model. */
  text?: string;
};

/** What a provider read of a model's licence. */
export type ProviderLicense = {
  /** A catalogue id; null for one Thingport doesn't know, shown by its label and terms. */
  id: string | null;
  /** The site's own value, kept so a better mapping can read it again. */
  raw: string;
  /** The site's name for it, where that says more than the catalogue's (a site licence's add-ons). */
  label?: string | null;
  /** The site's link to it, where the catalogue's isn't the one. */
  url?: string | null;
  /** The site's or the creator's own words: a site licence's text, or terms added to a standard licence. Plain text. */
  terms?: string | null;
  /** Only where this model's terms differ from the licence's own (MyMiniFactory's per-model permissions, a site that
   *  forbids sharing what the licence would allow). */
  allows?: LicenseAction[];
  /** The same, for what it asks (MyMiniFactory's "mention", an OCL attribution add-on). */
  requires?: Partial<LicenseDef["requires"]>;
};

// Raised when a provider's mapping changes, so a model read before is read again the next time it's opened. Only
// models with a licence carry it: one whose site stated none is read again only if a migration clears its
// licenseReadAt, as one should for that site's models when its mapping starts finding a licence it didn't before.
export const LICENSE_MAP_VERSION = 1;

const NONE = { credit: false, sameLicense: false };
const CREDIT = { credit: true, sameLicense: false };
const SHARE_ALIKE = { credit: true, sameLicense: true };

// Creative Commons: by, then nc / nd / sa in the order its names use.
const CC_KINDS = [
  { code: "by", label: "Attribution", allows: ["share", "remix", "commercial"], sa: false },
  { code: "by-sa", label: "Attribution-ShareAlike", allows: ["share", "remix", "commercial"], sa: true },
  { code: "by-nd", label: "Attribution-NoDerivatives", allows: ["share", "commercial"], sa: false },
  { code: "by-nc", label: "Attribution-NonCommercial", allows: ["share", "remix"], sa: false },
  { code: "by-nc-sa", label: "Attribution-NonCommercial-ShareAlike", allows: ["share", "remix"], sa: true },
  { code: "by-nc-nd", label: "Attribution-NonCommercial-NoDerivatives", allows: ["share"], sa: false },
] as const satisfies readonly { code: string; label: string; allows: readonly LicenseAction[]; sa: boolean }[];
const CC_VERSIONS = ["4.0", "3.0"] as const;

function ccDefs(): LicenseDef[] {
  return CC_VERSIONS.flatMap((version) =>
    CC_KINDS.map((kind) => ({
      id: `CC-${kind.code.toUpperCase()}-${version}`,
      short: `CC ${kind.code.toUpperCase()} ${version}`,
      name: `Creative Commons ${kind.label} ${version}${version === "4.0" ? " International" : " Unported"}`,
      url: `https://creativecommons.org/licenses/${kind.code}/${version}/`,
      family: "cc" as const,
      marks: ["cc", ...(kind.code.split("-") as LicenseMark[])],
      allows: [...kind.allows],
      requires: kind.sa ? SHARE_ALIKE : CREDIT,
    })),
  );
}

const ALL: LicenseAction[] = ["share", "remix", "commercial"];

const OPEN: LicenseDef[] = [
  [
    "GPL-2.0",
    "GPL 2.0",
    "GNU General Public License v2.0",
    "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
    SHARE_ALIKE,
  ],
  ["GPL-3.0", "GPL 3.0", "GNU General Public License v3.0", "https://www.gnu.org/licenses/gpl-3.0.html", SHARE_ALIKE],
  [
    "LGPL-3.0",
    "LGPL 3.0",
    "GNU Lesser General Public License v3.0",
    "https://www.gnu.org/licenses/lgpl-3.0.html",
    SHARE_ALIKE,
  ],
  ["BSD-2-Clause", "BSD", "BSD 2-Clause License", "https://opensource.org/licenses/BSD-2-Clause", CREDIT],
  ["MIT", "MIT", "MIT License", "https://opensource.org/licenses/MIT", CREDIT],
  ["Apache-2.0", "Apache 2.0", "Apache License 2.0", "https://www.apache.org/licenses/LICENSE-2.0", CREDIT],
  ["CERN-OHL-1.2", "CERN OHL 1.2", "CERN Open Hardware Licence v1.2", "https://ohwr.org/cernohl", SHARE_ALIKE],
  [
    "CERN-OHL-S-2.0",
    "CERN-OHL-S 2.0",
    "CERN Open Hardware Licence Version 2 - Strongly Reciprocal",
    "https://ohwr.org/cern_ohl_s_v2.txt",
    SHARE_ALIKE,
  ],
].map(([id, short, name, url, requires]) => ({
  id: id as string,
  short: short as string,
  name: name as string,
  url: url as string,
  family: "open" as const,
  marks: [],
  allows: ALL,
  requires: requires as LicenseDef["requires"],
}));

const site = (
  id: string,
  short: string,
  name: string,
  allows: LicenseAction[],
  opts: { url?: string | null; requires?: LicenseDef["requires"]; text?: string } = {},
): LicenseDef => ({
  id,
  short,
  name,
  url: opts.url ?? null,
  family: "site",
  marks: [],
  allows,
  requires: opts.requires ?? NONE,
  ...(opts.text ? { text: opts.text } : {}),
});

const THREEDEXPORT_ROYALTY_FREE_TEXT =
  "Use it in your own projects, commercial ones too, as many times as you like, without paying royalties. It may not " +
  "be sold, given or passed on to anyone else in the form it was downloaded in, and the seller keeps it to sell on.";
const THREEDEXPORT_BASIC_TEXT =
  "Use it in a single application of your own or for a client, such as a video, a visualization, or prints given " +
  "away for free, alone or incorporated into your own work. No reselling or giving away the files, and no use in " +
  "something made for sale: that takes the Extended License.";
const THREEDEXPORT_NO_AI_TEXT = "Not for machine learning or training AI models.";

const SDFL_TEXT =
  "Digital files have a strict non-commercial, personal use only license. You shall not share, sub-license, sell, " +
  "rent, host, transfer, or distribute in any way the digital file or 3D printed versions of this object, nor any " +
  "other derivative work of this object in its digital or physical format (including remixes of this object).";

const SITE: LicenseDef[] = [
  // The Open Community Licence: remixing and sharing under the same licence, commercial reselling not allowed.
  site("OCL-1.0", "OCL v1", "Open Community License v1", ["share", "remix"], {
    url: "https://github.com/OpenCommunityLicence/OpenCommunityLicence",
    requires: { credit: false, sameLicense: true },
  }),
  site("OCL-1.1", "OCL v1.1", "Open Community License v1.1", ["share", "remix"], {
    url: "https://github.com/OpenCommunityLicence/OpenCommunityLicence",
    requires: { credit: false, sameLicense: true },
  }),
  // Printables, NexPrint, MakerOnline, Snapmaker and Thangs all use this one, word for word or nearly.
  site("sdfl", "Standard Digital File License", "Standard Digital File License", [], { text: SDFL_TEXT }),
  site("makerworld-exclusive", "MakerWorld Exclusive License", "MakerWorld Exclusive License", [], {
    requires: CREDIT,
  }),
  site("makerworld-sdfl-community", "SDFL - Community Use", "Standard Digital File License - Community Use", []),
  site(
    "makerworld-sdfl-ppo",
    "SDFL - Platform Print Only",
    "Standard Digital File License - Platform Print Only (SDFL-PPO)",
    [],
  ),
  site("printables-commercial", "Commercial Use", "Printables Commercial Use", ["remix", "commercial"], {
    text:
      "You can print, sell, and distribute as many 3D prints of the model as you want for commercial use. You are " +
      "allowed to modify (remix) the 3D model files. It is forbidden to distribute original or modified 3D model " +
      "digital files in any way, such as sale, exchange, reupload, donation, etc.",
  }),
  site("printables-commercial-nd", "Commercial Use - No Derivative", "Printables Commercial Use - No Derivative", [
    "commercial",
  ]),
  site("cults-pu", "CULTS PU", "Cults - Private Use", [], {
    url: "https://cults3d.com/en/licenses#cults_pu",
    text:
      "Print and use the 3D prints for private use, and share pictures of them. No commercial use or public sharing " +
      "of the model or its prints; no modification for sharing or sale; no distribution of the digital files.",
  }),
  site("cults-cu", "CULTS CU", "Cults - Commercial Use", ["remix", "commercial"], {
    url: "https://cults3d.com/en/licenses#cults_cu",
    requires: CREDIT,
    text:
      "Print, sell and distribute 3D prints of the model and its adaptations, commercially too, and remix it. Credit " +
      "the creator; no distribution of the digital files or of files adapted from them.",
  }),
  site("cults-cu-nd", "CULTS CU-ND", "Cults - Commercial Use - No Derivative", ["commercial"], {
    url: "https://cults3d.com/en/licenses#cults_cu_nd",
    requires: CREDIT,
    text:
      "Print and distribute 3D prints of the model, commercially too. Credit the creator; no modification, and no " +
      "distribution or resale of the digital files.",
  }),
  site("snapmaker-only", "Snapmaker-Only License", "Snapmaker-Only License", []),
  site("crealitycloud-standard", "Standard License", "Creality Cloud Standard License", [], {
    text:
      "For personal use only, and not for any commercial use. The model may not be shared, transmitted, " +
      "redistributed, remixed, duplicated, or sold.",
  }),
  site("eufymake-private", "Private Use", "eufyMake Private Use", [], {
    text:
      "Print for private use in unlimited quantity, and share pictures of your prints. No commercial use or public " +
      "sharing; no modifying it for sharing or sale; no distributing the files.",
  }),
  site("pixup3d-private", "Private Use", "PIXUP Private Use", [], {
    url: "https://pixup3d.com/en/term_service",
    text:
      "Copyright is owned by the designer: the model is only allowed for private use. The buyer gets a nonexclusive " +
      "authorization for personal and noncommercial use, not the copyright.",
  }),
  site("fab365-personal", "Personal Use", "Fab365 Personal Use", [], {
    url: "https://fab365.net/terms",
    text:
      "For personal use only, and the copyright stays the designer's. Print the model for yourself and share pictures " +
      "of your prints; no commercial use, and no sharing, reselling or redistributing the files or the prints.",
  }),
  site("grabcad-terms", "GrabCAD Terms", "GrabCAD Community Cross License", ["remix"], {
    url: "https://grabcad.com/terms",
    text:
      "Every GrabCAD member may use, copy, modify and make derivative works of it for their own non-commercial, " +
      "internal use. The licence can't be sublicensed or transferred.",
  }),
  site("owlcad-terms", "OwlCAD Terms", "OwlCAD public gallery terms", ["remix", "commercial"], {
    url: "https://owlcad.com/terms",
    text:
      "Published to OwlCAD's public gallery: anyone may view it, download it and remix it, and modify it for their " +
      "own use, commercially too.",
  }),
  site("meshy-private", "Private", "Meshy Private", [], {
    text: "Private to its owner, who keeps every right to it: generated on a paid Meshy plan, or their own upload.",
  }),
  // CGTrader's own: royalty free allows remixing and commercial use but not passing the files on; editorial, neither.
  site("cgtrader-royalty-free", "Royalty Free", "CGTrader Royalty Free License", ["remix", "commercial"], {
    url: "https://www.cgtrader.com/pages/terms-and-conditions#general-terms-of-licensing",
  }),
  site(
    "cgtrader-royalty-free-no-ai",
    "Royalty Free (no AI)",
    "CGTrader Royalty Free License, no AI use",
    ["remix", "commercial"],
    { url: "https://www.cgtrader.com/pages/terms-and-conditions#general-terms-of-licensing" },
  ),
  site("cgtrader-editorial", "Editorial", "CGTrader Editorial License", [], {
    url: "https://www.cgtrader.com/pages/terms-and-conditions#general-terms-of-licensing",
  }),
  site("cgtrader-editorial-no-ai", "Editorial (no AI)", "CGTrader Editorial License, no AI use", [], {
    url: "https://www.cgtrader.com/pages/terms-and-conditions#general-terms-of-licensing",
  }),
  site("cgtrader-custom", "Custom", "CGTrader Custom License", [], {
    url: "https://www.cgtrader.com/pages/terms-and-conditions#general-terms-of-licensing",
  }),
  site("cgtrader-custom-no-ai", "Custom (no AI)", "CGTrader Custom License, no AI use", [], {
    url: "https://www.cgtrader.com/pages/terms-and-conditions#general-terms-of-licensing",
  }),
  // 3DExport's own: a free model is royalty free, used in your own work, commercial too, but never passed on as it
  // came; a bought one is under the Basic licence it's sold with, unless the buyer paid for the Extended one.
  site("3dexport-royalty-free", "Royalty Free", "3DExport Royalty Free License", ["remix", "commercial"], {
    url: "https://help.3dexport.com/item/royalty-free-license/",
    text: THREEDEXPORT_ROYALTY_FREE_TEXT,
  }),
  site(
    "3dexport-royalty-free-no-ai",
    "Royalty Free (no AI)",
    "3DExport Royalty Free License, no AI training",
    ["remix", "commercial"],
    {
      url: "https://help.3dexport.com/item/no-ai-training-license/",
      text: `${THREEDEXPORT_ROYALTY_FREE_TEXT} ${THREEDEXPORT_NO_AI_TEXT}`,
    },
  ),
  site("3dexport-basic", "Basic License", "3DExport Basic License", ["remix"], {
    url: "https://help.3dexport.com/item/basic-license-and-extended-license/",
    text: THREEDEXPORT_BASIC_TEXT,
  }),
  site("3dexport-basic-no-ai", "Basic License (no AI)", "3DExport Basic License, no AI training", ["remix"], {
    url: "https://help.3dexport.com/item/basic-license-and-extended-license/",
    text: `${THREEDEXPORT_BASIC_TEXT} ${THREEDEXPORT_NO_AI_TEXT}`,
  }),
  // Built from each model's own permissions, which its provider passes as `allows`.
  site("myminifactory", "MyMiniFactory", "MyMiniFactory License", [], {
    url: "https://www.myminifactory.com/object-licensing",
  }),
  site("myminifactory-store", "Digital File Store License", "MyMiniFactory Digital File Store License", [], {
    url: "https://www.myminifactory.com/object-licensing",
  }),
];

const PUBLIC: LicenseDef[] = [
  {
    id: "CC0-1.0",
    short: "CC0 1.0",
    name: "Creative Commons Zero 1.0 Universal (public domain)",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    family: "cc",
    marks: ["zero"],
    allows: ALL,
    requires: NONE,
  },
  {
    id: "public-domain",
    short: "Public Domain",
    name: "Public Domain",
    url: "https://creativecommons.org/publicdomain/mark/1.0/",
    family: "cc",
    marks: ["pd"],
    allows: ALL,
    requires: NONE,
  },
];

const RESERVED: LicenseDef = {
  id: "all-rights-reserved",
  short: "All rights reserved",
  name: "All rights reserved",
  url: null,
  family: "reserved",
  marks: [],
  allows: [],
  requires: NONE,
};

export const LICENSES: readonly LicenseDef[] = [...ccDefs(), ...PUBLIC, ...OPEN, ...SITE, RESERVED];
const BY_ID = new Map(LICENSES.map((license) => [license.id.toLowerCase(), license]));

export function licenseById(id: string | null | undefined): LicenseDef | null {
  return id ? (BY_ID.get(id.toLowerCase()) ?? null) : null;
}

/** The ones an owner can pick for any model: the standard licences, and "All rights reserved". Creative Commons' older
 *  3.0 versions are only for what a site already lists. */
export const PICKABLE_LICENSE_IDS: readonly string[] = LICENSES.filter(
  (l) => l.family !== "site" && !(l.family === "cc" && l.id.endsWith("-3.0")),
).map((l) => l.id);

/** A Creative Commons licence from the parts a site names it by: "BY-NC-SA", "by_nc_sa", "CC BY-NC", "cc-nc-sa". */
export function ccLicenseId(parts: string, version: (typeof CC_VERSIONS)[number] = "4.0"): string | null {
  const words = parts
    .toLowerCase()
    .replace(/^cc[\s_-]*/, "")
    .split(/[\s_-]+/)
    .filter(Boolean);
  // "CC" alone names no licence; without this it would read as BY.
  if (!words.length) return null;
  const want = new Set(words.filter((w) => w !== "by"));
  for (const kind of CC_KINDS) {
    const have = new Set(kind.code.split("-").filter((w) => w !== "by"));
    if (have.size === want.size && [...want].every((w) => have.has(w)))
      return `CC-${kind.code.toUpperCase()}-${version}`;
  }
  return null;
}

/** A licence from its link: a Creative Commons deed or legal code, CC0, the public domain mark, or a GNU licence. */
export function licenseIdFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://creativecommons.org");
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "creativecommons.org") {
    if (parts[0] === "publicdomain" && parts[1] === "zero") return "CC0-1.0";
    if (parts[0] === "public-domain" && parts[1] === "cc0") return "CC0-1.0";
    if (parts[0] === "publicdomain" && parts[1] === "mark") return "public-domain";
    if (parts[0] === "licenses" && parts[1] === "publicdomain") return "public-domain";
    if (parts[0] === "licenses" && parts[1]) {
      const version = parts[2] === "3.0" ? "3.0" : "4.0";
      return ccLicenseId(parts[1], version);
    }
    return null;
  }
  if (host === "gnu.org") {
    const page = parts.at(-1) ?? "";
    if (page.startsWith("lgpl")) return "LGPL-3.0";
    if (page.startsWith("gpl-2.0")) return "GPL-2.0";
    if (page.startsWith("gpl")) return "GPL-3.0";
  }
  return null;
}

/** A licence named in free text: a file name, a site's long name ("Creative Commons - Attribution - Non-Commercial").
 *  Null when it doesn't say clearly. */
export function licenseIdFromText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.toLowerCase().replace(/[_]+/g, " ");
  if (/standard digital file/.test(text)) return "sdfl";
  if (/\bcc0\b|cc zero|public domain dedication/.test(text)) return "CC0-1.0";
  if (/creative commons|\bcc[\s-]?by\b/.test(text)) {
    // The version is the licence's own, right after its name and parts ("CC BY-SA 4.0", "Attribution-NonCommercial 3.0
    // Unported", "CC BY v2.0"); a number anywhere else ("Thing v2.1", "release 2.0") is something else's. At one the
    // catalogue doesn't have, it's no licence Thingport knows, rather than the same one at 4.0.
    const named = text.match(
      /(?:\bcc[\s-]?by|\battribution)(?:[\s_-]+(?:non[\s-]?commercial|nc|no[\s-]?deriv\w*|nd|share[\s-]?alike|sa))*[\s_,-]+v?(\d\.\d)\b/,
    )?.[1];
    if (named && named !== "3.0" && named !== "4.0") return null;
    const version = named === "3.0" ? "3.0" : "4.0";
    const parts = ["by"];
    if (/non[\s-]?commercial|\bnc\b/.test(text)) parts.push("nc");
    if (/no[\s-]?deriv|\bnd\b/.test(text)) parts.push("nd");
    if (/share[\s-]?alike|\bsa\b/.test(text)) parts.push("sa");
    if (parts.length === 1 && !/attribution|\bby\b/.test(text))
      return /public domain/.test(text) ? "public-domain" : null;
    return ccLicenseId(parts.join("-"), version);
  }
  if (/\bpublic domain\b/.test(text)) return "public-domain";
  if (/\blgpl\b|lesser general public/.test(text)) return "LGPL-3.0";
  if (/\bgpl\b|general public license/.test(text)) return /\b2\.0\b|\bv2\b/.test(text) ? "GPL-2.0" : "GPL-3.0";
  if (/\bmit\b/.test(text)) return "MIT";
  if (/\bapache\b/.test(text)) return "Apache-2.0";
  if (/\bbsd\b/.test(text)) return "BSD-2-Clause";
  return null;
}
