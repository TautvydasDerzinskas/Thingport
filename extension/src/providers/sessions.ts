// How each provider's sign-in reads from this browser's cookies (eufyMake's from its pages' storage), for
// background/sessionSync.ts. One without is signed in some other way (an admin's key, the user's own API key or
// username) or not at all.

import type { ProviderId } from "./index.generated";
import type { SessionSource } from "../background/sessionSync";
import { crealitycloudSession } from "./crealitycloud/session";
import { cults3dSession } from "./cults3d/session";
import { eufymakeSession } from "./eufymake/session";
import { makeronlineSession } from "./makeronline/background";
import { myminifactorySession } from "./myminifactory/session";
import { nexprintSession } from "./nexprint/session";
import { pinshapeSession } from "./pinshape/session";
import { snapmakerSession } from "./snapmaker/session";
import { thangsSession } from "./thangs/session";
import { makerablesSession } from "./makerables/session";
import { toymakr3dSession } from "./toymakr3d/session";

export const SESSION_SOURCES: Partial<Record<ProviderId, SessionSource>> = {
  myminifactory: myminifactorySession,
  snapmaker: snapmakerSession,
  makeronline: makeronlineSession,
  crealitycloud: crealitycloudSession,
  nexprint: nexprintSession,
  thangs: thangsSession,
  cults3d: cults3dSession,
  eufymake: eufymakeSession,
  pinshape: pinshapeSession,
  toymakr3d: toymakr3dSession,
  makerables: makerablesSession,
};
