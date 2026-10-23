const BUILTIN = /^builtin:[a-z]+\/[a-z0-9-]+$/;
// Uploaded icons: see backend services/iconService.ts.
const UPLOADED = /^\/api\/icons\/[a-f0-9]{32}\.(png|svg)$/;

/** Whether a stored icon is one of Thingport's own or one the user uploaded, rather than an address on the web. */
export function isIconRef(value: string): boolean {
  return BUILTIN.test(value) || UPLOADED.test(value);
}
