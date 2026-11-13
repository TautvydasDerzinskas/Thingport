import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { catalogs, detectLocale, localeOf, LOCALES, setLocale, t } from "./i18n";
import { ABOUT, PROVIDER_IDS } from "../providers/index.generated";

const TRANSLATED_LOCALES = LOCALES.filter((locale) => locale !== "en");

const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).toSorted();

const contentKeys = [
  "setupIntro",
  "setupInstanceUrl",
  "setupInstanceUrlExample",
  "setupPair",
  "setupPairHint",
  "setupSecurityHint",
  "setupApprovalRevoked",
  "setupCredentialsRejected",
  "setupUnreachable",
  "setupSignInFailed",
  "setupConnect",
  "setupOpen",
  "setupOpened",
  "setupOpenFailed",
  "scriptSharedShort",
  "scriptWithheldShort",
  "scriptSharedExplainer",
  "scriptWithheldExplainer",
  "scriptNoScad",
  "scriptScadIncluded",
  "fabNotSetUp",
  "fabCannotSignIn",
  "fabImportedOpen",
  "fabAddMissingProfiles",
  "fabFetchMissingDetails",
  "fabAddPrintProfile",
  "guidedImportStopped",
  "overlayPrintProfileProgress",
  "overlayProgress",
  "importingFromMakerWorld",
  "nextIn",
  "pausedCaptcha",
  "captchaInstructions",
  "fabGrab",
  "fabInLibrary",
  "fabImported",
  "fabSetUp",
  "fabSignIn",
  "funAskingSite",
  "funSniffingFile",
  "funPeekingDownload",
  "funReadingNameTag",
  "funMeasuringTwice",
  "funCheckingModel",
  "funShakingBox",
  "funReadingFinePrint",
  "funCarryingFrom",
  "funDownloadingFile",
  "funCrunchingModel",
  "funUnpackingPlates",
  "funTakingPhotos",
  "funFramingThumb",
  "funWritingLabel",
  "funCreditingDesigner",
  "funFindingShelf",
  "funFillingBlanks",
  "funAskingSiteDetails",
  "funMissingPhotos",
  "funLeaveEdits",
  "funComparingNotes",
  "funDustingShelf",
  "funLoadingFiles",
  "funDownloadingArchive",
  "funUnzipping",
  "funCountingContents",
  "funPeekingFolders",
  "funSortingModels",
  "funUntanglingFileNames",
  "funFlippingSite",
  "funPagingList",
  "funCountingModels",
  "funGatheringThumbs",
  "funCheckingLibrary",
  "funLiningUp",
  "funGettingFile",
  "funFinding3mf",
  "funAskingMakerWorld",
  "adapting",
  "funKeepingColors",
  "funTranslatingSettings",
  "funRepackingPlates",
  "funSmoothing",
] as const;

const providerKeys = [
  "collectionDelay5Seconds",
  "collectionDelay30Seconds",
  "collectionDelay1Minute",
  "collectionDelay2Minutes",
  "collectionDelay5Minutes",
  "collectionDefaultProfile",
  "collectionDesignerProfiles",
  "collectionCommunityProfiles",
  "collectionWaitBetweenModels",
  "collectionWaitBetweenProfiles",
  "couldNotFindMakerworldModels",
  "checkingModelsInLibrary",
  "modelsToImport",
  "modelsAlreadyInLibrary",
  "allModelsAlreadyInLibrary",
  "modelsGoIntoSyncedCollection",
  "modelsGoIntoCollection",
  "addToCollection",
  "collectionImportPace",
  "collectionProfilesPace",
  "collectionProfilesExistingPace",
  "importCollection",
  "noModelsFound",
  "addingExistingModelsToCollection",
  "nothingNewCollectionImport",
  "adaptedDownloadExplanationUnknown",
  "adaptedDownloadExplanationCreality",
  "adaptedDownloadExplanationBambu",
  "adaptedDownloadExplanationCura",
  "adaptedDownloadExplanationOther",
  "adaptedDownloadKnownSlicer",
  "adaptedDownloadOtherSlicers",
  "adaptedDownloadTooBig",
  "adaptedDownloadProgress",
  "adaptedDownloadProgressUnknown",
  "couldNotGetMakerworldFile",
  "makerworldFileServerRefused",
  "couldNotAdaptMakerworldFile",
  "makerworldCaptchaMessage",
  "makerworldDownloadLimit",
  "guidedImportAborted",
  "couldNotReadMakerworldProfiles",
  "makerworldTabClosed",
  "paidModel",
  "buyOnPixup",
  "needsMeshyPro",
  "meshyCommunityLocked",
  "needsPaidMeshyPlan",
  "meshyOwnLocked",
  "buyOnMyMiniFactory",
  "buyOnCgtrader",
  "buyOnCults3d",
  "buyOnThreedexport",
  "soldAsPrint",
  "thangsPrintOnly",
  "buyOnThangs",
] as const;

const backgroundKeys = [
  "thingportRedirectsTo",
  "thingportCredentialRedirect",
  "couldNotSignInToThingport",
  "reloginApprovalRejected",
  "reloginCredentialsRejected",
  "grabNotConfigured",
  "grabDisabled",
  "requestFailed",
  "couldNotOpenThingportTab",
  "thingportAnswered",
  "makeronlineNotOnSite",
  "makeronlineCouldNotReachThingport",
  "makeronlineCouldNotAskFiles",
  "makeronlineCaptcha",
  "makeronlineSignIn",
  "makeronlineNoFile",
  "makeronlineCouldNotSignFiles",
  "owlcadEditorDidNotStart",
  "owlcadNoSharedModel",
  "owlcadNoExport",
  "owlcadEditorSlow",
  "owlcadCouldNotOpenTab",
  "owlcadEditorUnreachable",
  "owlcadEditorNoAnswer",
  "owlcadCouldNotExport",
  "owlcadNotModelLink",
  "printablesHttp",
  "printablesNoData",
  "printablesNoCollections",
  "printablesLikesTruncated",
  "printablesCollectionModelsTruncated",
  "couldNotReadPrintables",
  "printablesModelFallback",
  "printablesCollectionFallback",
  "printablesCollections",
  "printablesLikes",
] as const;

describe("runtime localization", () => {
  it("rejects duplicate source keys before JSON parsing", () => {
    for (const locale of LOCALES) {
      const source = readFileSync(new URL(`./locales/${locale}.json`, import.meta.url), "utf8");
      const keys = [...source.matchAll(/^\s{2}"([^"\\]+)"\s*:/gm)].map((match) => match[1]);
      expect(new Set(keys).size, locale).toBe(keys.length);
    }
  });
  it("keeps every catalog structurally aligned with English", () => {
    const english = Object.keys(catalogs.en).toSorted();
    for (const locale of LOCALES) expect(Object.keys(catalogs[locale]).toSorted()).toEqual(english);
  });

  it("keeps popup placeholders aligned without relying on English fallback", () => {
    const popupKeys = [
      "connectionCredentialsRejected",
      "connectionUnreachable",
      "openInstance",
      "comingSoonOn",
      "openSite",
      "enableSite",
      "recentImportTitle",
      "recentlyViewedTitle",
    ];
    for (const locale of LOCALES) {
      for (const key of popupKeys) expect(placeholders(catalogs[locale][key])).toEqual(placeholders(catalogs.en[key]));
    }
  });

  it("supplies translated content-dialog and status phrases without English fallback", () => {
    for (const locale of TRANSLATED_LOCALES) {
      for (const key of contentKeys) {
        expect(catalogs[locale][key]).not.toBe(catalogs.en[key]);
        expect(placeholders(catalogs[locale][key])).toEqual(placeholders(catalogs.en[key]));
      }
    }
  });

  it("supplies translated MakerWorld and provider blocks without English fallback", () => {
    for (const locale of TRANSLATED_LOCALES) {
      for (const key of providerKeys) {
        expect(catalogs[locale][key]).not.toBe(catalogs.en[key]);
        expect(placeholders(catalogs[locale][key])).toEqual(placeholders(catalogs.en[key]));
      }
    }
  });

  it("supplies translated background and provider errors without English fallback", () => {
    for (const locale of TRANSLATED_LOCALES) {
      for (const key of backgroundKeys) {
        expect(catalogs[locale][key]).not.toBe(catalogs.en[key]);
        expect(placeholders(catalogs[locale][key])).toEqual(placeholders(catalogs.en[key]));
      }
    }
  });

  it("keeps provider-card English descriptions generated from provider docs and translates each one", () => {
    for (const provider of PROVIDER_IDS) {
      const key = `providerAbout.${provider}`;
      expect(catalogs.en[key]).toBe(ABOUT[provider]);
      for (const locale of TRANSLATED_LOCALES) expect(catalogs[locale][key]).not.toBe(catalogs.en[key]);
    }
  });

  it("translates popup-owned dynamic messages in every supported language", () => {
    const keys = [
      "disconnectFromThingport",
      "enableAllTitle",
      "pairUnsupported",
      "connectionApprovalRevoked",
      "disconnectedApprovalKept",
      "yourThingportInstance",
      "comingSoon",
    ];
    for (const locale of TRANSLATED_LOCALES) {
      for (const key of keys) expect(catalogs[locale][key]).not.toBe(catalogs.en[key]);
    }
  });

  it("selects Belarusian without relying on browser i18n support", () => {
    expect(detectLocale(["be-BY", "en-US"])).toBe("be");
    setLocale("be");
    expect(t("addToQueue")).toBe("Дадаць у чаргу");
  });

  it("uses English for an invalid saved locale without consulting navigator", () => {
    expect(localeOf("not-a-locale", [])).toBe("en");
  });

  it("interpolates values without altering protected values", () => {
    setLocale("uk");
    expect(t("enableOn", { site: "MakerWorld" })).toBe("Увімкнути на MakerWorld");
  });
});
