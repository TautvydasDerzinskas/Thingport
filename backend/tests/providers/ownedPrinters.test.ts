import { describe, expect, it } from "vitest";
import { brandPrinterForName } from "../../src/printers/catalogue";
import { brandOwnedPrinters } from "../../src/providers/ownedPrinters";
import { crealitycloudDeviceModels } from "../../src/providers/crealitycloud/api";
import { snapmakerDeviceModels } from "../../src/providers/snapmaker/api";
import { voxelshareDeviceModels } from "../../src/providers/voxelshare/api";
import { makeronlineProfilePrinter } from "../../src/providers/makeronline/api";

// The answers here are hand-made, shaped as each site's own client reads them: no account Thingport was tried with
// had a printer bound but Bambu Lab's.

describe("a site's names for a printer's model", () => {
  it("find the brand's printer with or without the brand's name, and only that brand's", () => {
    expect(brandPrinterForName("creality", "K1C")?.printer.id).toBe("creality-k1c");
    expect(brandPrinterForName("creality", "Creality K1C")?.printer.id).toBe("creality-k1c");
    expect(brandPrinterForName("flashforge", "Adventurer 5M Pro")?.printer.id).toBe("flashforge-adventurer5mpro");
    expect(brandPrinterForName("snapmaker", "U1")?.printer.id).toBe("snapmaker-u1");
    expect(brandPrinterForName("creality", "Bambu Lab P1S")).toBeNull();
    expect(brandPrinterForName("creality", "")).toBeNull();
    expect(brandPrinterForName("no-such-brand", "K1C")).toBeNull();
  });

  it("take each printer's first name the catalogue knows, and leave out one it knows by none", () => {
    expect(brandOwnedPrinters("creality", [["CR-K1C-internal", "K1C"], ["Printer of the future"]])).toEqual([
      { printerId: "creality-k1c", nozzle: null },
    ]);
  });
});

describe("each site's printer list", () => {
  it("Creality Cloud: grouped and ungrouped printers, by their type's name and then its internal one", () => {
    const result = {
      groupList: [
        { groupName: "Farm", deviceList: [{ deviceName: "SN1", deviceType: { name: "K1C", internalName: "CR-K1C" } }] },
      ],
      ungroupedList: [{ factorySn: "SN2", deviceType: { internalName: "Ender-3 V3 KE" } }, { deviceType: null }],
    };
    expect(crealitycloudDeviceModels(result)).toEqual([["K1C", "CR-K1C"], ["Ender-3 V3 KE"]]);
    expect(crealitycloudDeviceModels(null)).toEqual([]);
  });

  it("Snapmaker: by product name, then model and product code", () => {
    const data = [
      { sn: "SN1", mac: "aa", productName: "Snapmaker U1", deviceModel: "U1", productCode: "U1" },
      { sn: "SN2", productCode: "J1" },
      { sn: "SN3" },
    ];
    expect(snapmakerDeviceModels(data)).toEqual([["Snapmaker U1", "U1", "U1"], ["J1"]]);
    expect(snapmakerDeviceModels({ list: [{ productName: "A350" }] })).toEqual([["A350"]]);
  });

  it("VoxelShare: Flashforge's printers by their model", () => {
    const data = { detail: [{ devId: "1", serialNumber: "SN", model: "Adventurer 5M Pro" }, { devId: "2" }], total: 2 };
    expect(voxelshareDeviceModels(data)).toEqual([["Adventurer 5M Pro"]]);
    expect(voxelshareDeviceModels({ detail: [], total: 0, next: false })).toEqual([]);
  });

  it("MakerOnline: the printer a profile picked, by its choice's label", () => {
    const options = [
      { label: "Anycubic Kobra 3", value: 10 },
      { label: "Other", value: 0 },
    ];
    expect(makeronlineProfilePrinter({ print_type: 1, printer_id: 10 }, options)).toBe("Anycubic Kobra 3");
    expect(makeronlineProfilePrinter({ print_type: 0, printer_id: 0 }, options)).toBeNull();
    expect(makeronlineProfilePrinter({ print_type: 1, printer_id: 99 }, options)).toBeNull();
    expect(brandOwnedPrinters("anycubic", [["Anycubic Kobra 3"]])).toEqual([
      { printerId: "anycubic-kobra3", nozzle: null },
    ]);
  });
});
