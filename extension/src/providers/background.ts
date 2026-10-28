// Each provider's own background messages, and what it does on the background's events, which background/index.ts
// wires in beside its own.

import type { BackgroundMessages, Handlers } from "../shared/messages";
import { MANIFESTS } from "./index.generated";
import { syncSession } from "../background/sessionSync";
import { makeronlineHandlers } from "./makeronline/background";
import { owlcadHandlers } from "./owlcad/background";
import { advanceJob, dropJobIfForTab, makerworldHandlers } from "./makerworld/job";
import { printablesHandlers } from "./printables/background";
import { scheduleSnapmakerRenewal, SNAPMAKER_ALARM } from "./snapmaker/session";

export const PROVIDER_HANDLERS: Partial<Handlers<BackgroundMessages>> = {
  ...makeronlineHandlers,
  ...owlcadHandlers,
  ...makerworldHandlers,
  ...printablesHandlers,
};

/** On every wake of the background, and whenever site access changes. Snapmaker's sign-in lasts a day: renewed on a
 *  timer too, so syncs keep working on days Snapmaker isn't visited. */
export function onProvidersWake(): void {
  void scheduleSnapmakerRenewal();
}

export function onProviderAlarm(name: string): void {
  if (name === SNAPMAKER_ALARM) void syncSession(MANIFESTS.snapmaker.id);
}

/** A page finished loading: it wakes a suspended background to drive MakerWorld's guided import. */
export function onProviderTabLoaded(tabId: number): void {
  void advanceJob(tabId);
}

export function onProviderTabClosed(tabId: number): void {
  void dropJobIfForTab(tabId);
}
