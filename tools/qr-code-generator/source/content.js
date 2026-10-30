// What the code says: the text a reader gets, built from what was typed.
//
// A QR code is only ever text; what makes a phone offer to join a network or save a contact is the shape of that
// text. Those shapes are here, each with its own escaping, so the window can collect fields rather than make the
// user write `WIFI:T:WPA;S:…;;` by hand.

/** The kinds of thing a code can hold, in the order the window offers them. */
export const KINDS = ["link", "text", "wifi", "contact"];

/** The fields each kind collects: what the window draws, and what `textFor` reads. */
export const FIELDS = {
  link: [{ name: "url", type: "text" }],
  text: [{ name: "text", type: "area" }],
  wifi: [
    { name: "ssid", type: "text" },
    { name: "password", type: "text" },
    { name: "security", type: "choice", options: ["WPA", "WEP", "nopass"] },
    { name: "hidden", type: "switch" },
  ],
  contact: [
    { name: "format", type: "choice", options: ["mecard", "vcard"] },
    { name: "firstName", type: "text" },
    { name: "lastName", type: "text" },
    { name: "phone", type: "text" },
    { name: "email", type: "text" },
    { name: "organisation", type: "text" },
    { name: "url", type: "text" },
    { name: "address", type: "text" },
    { name: "note", type: "area" },
  ],
};

export const DEFAULT_CONTENT = {
  kind: "link",
  url: "https://thingport.app",
  shortenLink: false,
  text: "",
  ssid: "",
  password: "",
  security: "WPA",
  hidden: false,
  format: "mecard",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  organisation: "",
  contactUrl: "",
  address: "",
  note: "",
};

const trim = (value) => String(value ?? "").trim();

/** `\`, `;`, `,`, `:` and `"` mean something in a Wi-Fi or MECARD string, so they're escaped where they don't. */
const escapeField = (value) => trim(value).replace(/([\;,:"])/g, "\\$1");

/**
 * An address a reader will follow: a bare domain gets `https://`, and `shorten` puts the scheme and domain in
 * capitals, which a QR code can pack into fewer modules. Only those two are touched — a path is case-sensitive.
 */
export function normalizeUrl(value, shorten = false) {
  let url = trim(value);
  if (!url) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  if (!shorten) return url;
  return url.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]+)/i,
    (_, scheme, host) => scheme.toUpperCase() + host.toUpperCase(),
  );
}

/** Lines fit for a vCard: a line break inside a field would end the field. */
const vcardValue = (value) =>
  trim(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([;,])/g, "\\$1");

function wifiText(content) {
  const security = ["WPA", "WEP", "nopass"].includes(content.security) ? content.security : "WPA";
  const parts = [`T:${security}`, `S:${escapeField(content.ssid)}`];
  if (security !== "nopass" && trim(content.password)) parts.push(`P:${escapeField(content.password)}`);
  if (content.hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

function mecardText(content) {
  // The comma between the family name and the given one is MECARD's own separator, so each half is escaped and
  // the comma is put in afterwards — escaping the joined name would hide the separator.
  const name = [trim(content.lastName), trim(content.firstName)].filter(Boolean).map(escapeField).join(",");
  const parts = [];
  if (name) parts.push(`N:${name}`);
  if (trim(content.organisation)) parts.push(`ORG:${escapeField(content.organisation)}`);
  if (trim(content.phone)) parts.push(`TEL:${escapeField(content.phone)}`);
  if (trim(content.email)) parts.push(`EMAIL:${escapeField(content.email)}`);
  if (trim(content.contactUrl)) parts.push(`URL:${escapeField(content.contactUrl)}`);
  if (trim(content.address)) parts.push(`ADR:${escapeField(content.address)}`);
  if (trim(content.note)) parts.push(`NOTE:${escapeField(content.note.replace(/\r?\n/g, " "))}`);
  return `MECARD:${parts.join(";")};;`;
}

function vcardText(content) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  const last = vcardValue(content.lastName);
  const first = vcardValue(content.firstName);
  lines.push(`N:${last};${first};;;`);
  const full = [trim(content.firstName), trim(content.lastName)].filter(Boolean).join(" ");
  if (full) lines.push(`FN:${vcardValue(full)}`);
  if (trim(content.organisation)) lines.push(`ORG:${vcardValue(content.organisation)}`);
  if (trim(content.phone)) lines.push(`TEL;TYPE=CELL:${vcardValue(content.phone)}`);
  if (trim(content.email)) lines.push(`EMAIL:${vcardValue(content.email)}`);
  if (trim(content.contactUrl)) lines.push(`URL:${vcardValue(content.contactUrl)}`);
  if (trim(content.address)) lines.push(`ADR:;;${vcardValue(content.address)};;;;`);
  if (trim(content.note)) lines.push(`NOTE:${vcardValue(content.note)}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

/** The text the code carries, for what was typed. Empty when there isn't enough to say anything yet. */
export function textFor(content) {
  const kind = KINDS.includes(content.kind) ? content.kind : "link";
  if (kind === "link") return normalizeUrl(content.url, content.shortenLink);
  if (kind === "text") return String(content.text ?? "").replace(/\r\n?/g, "\n");
  if (kind === "wifi") return trim(content.ssid) ? wifiText(content) : "";
  const something = ["firstName", "lastName", "phone", "email", "organisation", "contactUrl", "address", "note"].some(
    (field) => trim(content[field]),
  );
  if (!something) return "";
  return content.format === "vcard" ? vcardText(content) : mecardText(content);
}

/** What's missing before there's anything to encode, as a key the window turns into words. */
export function missing(content) {
  const kind = KINDS.includes(content.kind) ? content.kind : "link";
  if (kind === "link") return trim(content.url) ? null : "needUrl";
  if (kind === "text") return trim(content.text) ? null : "needText";
  if (kind === "wifi") return trim(content.ssid) ? null : "needSsid";
  return textFor(content) ? null : "needContact";
}

/** A short name for the code, for a file or a saved model. */
export function nameFor(content) {
  const kind = KINDS.includes(content.kind) ? content.kind : "link";
  if (kind === "link") {
    const url = normalizeUrl(content.url);
    const host = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
    return host || "";
  }
  if (kind === "wifi") return trim(content.ssid);
  if (kind === "contact") return [trim(content.firstName), trim(content.lastName)].filter(Boolean).join(" ");
  return trim(content.text).split("\n")[0].slice(0, 40);
}

/** Whether what's in the code is private enough that a warning is worth showing before it's shared. */
export const carriesSecret = (content) =>
  content.kind === "wifi" && content.security !== "nopass" && Boolean(trim(content.password));
