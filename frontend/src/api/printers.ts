import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";

/** A printable area in mm, its origin the front-left corner's place in the printer's coordinates. */
export type PrinterBed = {
  shape: "rectangle" | "circle" | "polygon";
  x: number;
  y: number;
  origin: [number, number];
  diameter?: number;
  points?: [number, number][];
};

/** A printer from the printer catalogue (backend/assets/printers). */
export type PrinterSummary = {
  /** `<brand>-<model>`, stable across catalogue updates. */
  id: string;
  brand: string;
  model: string;
  bed: PrinterBed | null;
  height: number | null;
  /** As slicers name them ("0.4"). */
  nozzles: string[];
  extruders: number;
  cover?: true;
};

export type PrinterBrand = { id: string; name: string; printers: number };

export type UserPrinter = {
  printer: PrinterSummary;
  /** "Bambu Lab". */
  brandName: string;
  nozzle: string;
  /** Each slicer's printer preset for it and its nozzle, null where the slicer has none. */
  presets: Record<string, string | null>;
};

export type PrinterSuggestion = {
  printer: PrinterSummary;
  brandName: string;
  nozzle: string | null;
  sliced: number;
  projects: number;
  declined: boolean;
};

/** The user's printers, the ones their library suggests, and whether to offer finding them in their Bambu account. */
export type MyPrinters = { printers: UserPrinter[]; suggestions: PrinterSuggestion[]; bambu: boolean };

export type PrinterCatalogue = { brands: PrinterBrand[]; printers: PrinterSummary[] };

/** Thrown when finding printers in the Bambu account needs a MakerWorld sign-in first, or a new one. */
export class BambuSignInError extends Error {
  constructor(
    readonly reason: "signed-out" | "expired",
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers: authHeaders(init.headers) });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

let catalogue: Promise<PrinterCatalogue> | null = null;

export const printersApi = {
  /** Every printer there is to add, read once per page load. */
  catalogue: (): Promise<PrinterCatalogue> => {
    catalogue ??= call<PrinterCatalogue>("/printers/catalogue", {}, "Failed to load the printers").catch((err) => {
      catalogue = null;
      throw err;
    });
    return catalogue;
  },

  /** Public, like the catalogue it comes from, so an <img> needs no token. */
  coverUrl: (id: string) => `${apiBase()}/printers/${encodeURIComponent(id)}/cover.webp`,

  mine: (): Promise<MyPrinters> => call<MyPrinters>("/me/printers", {}, "Failed to load your printers"),

  /** Adds the printer, or sets its nozzle; a nozzle it doesn't take becomes its nearest. */
  put: (id: string, nozzle?: string | null): Promise<UserPrinter> =>
    call<UserPrinter>(
      `/me/printers/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nozzle: nozzle ?? null }),
      },
      "Failed to save the printer",
    ),

  remove: (id: string): Promise<void> =>
    call<void>(`/me/printers/${encodeURIComponent(id)}`, { method: "DELETE" }, "Failed to remove the printer"),

  /** Turns a suggestion down, or with false takes that back. */
  decline: (id: string, declined = true): Promise<void> =>
    call<void>(
      `/me/printers/${encodeURIComponent(id)}/declined`,
      { method: declined ? "PUT" : "DELETE" },
      "Failed to save the suggestion",
    ),

  /** Reads the printers bound to the Bambu account the user's MakerWorld sign-in is, and adds them. */
  findInBambuAccount: async (): Promise<UserPrinter[]> => {
    const res = await fetch(`${apiBase()}/me/printers/bambu`, { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; detail?: string };
      throw new BambuSignInError(body.code === "makerworld_rejected" ? "expired" : "signed-out", body.detail ?? "");
    }
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to find your printers"));
    return ((await res.json()) as { printers: UserPrinter[] }).printers;
  },
};
