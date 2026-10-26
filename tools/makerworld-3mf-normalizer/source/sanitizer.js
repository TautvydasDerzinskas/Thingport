/**
 * Universal 3MF sanitizer.
 * Flattens Bambu/Orca production-extension projects into core 3MF so Cura,
 * PrusaSlicer, and Anycubic can import them, while keeping painted colors,
 * filament colors, and designer process settings (walls, line width, infill, …).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ThreeMFSanitizer = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
    const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
    const THUMB_REL = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail";

    const BAMBU_TO_SLIC3R = {
        layer_height: "layer_height",
        initial_layer_print_height: "first_layer_height",
        wall_loops: "perimeters",
        top_shell_layers: "top_solid_layers",
        bottom_shell_layers: "bottom_solid_layers",
        top_shell_thickness: "top_solid_min_thickness",
        bottom_shell_thickness: "bottom_solid_min_thickness",
        sparse_infill_density: "fill_density",
        sparse_infill_pattern: "fill_pattern",
        line_width: "extrusion_width",
        outer_wall_line_width: "external_perimeter_extrusion_width",
        inner_wall_line_width: "perimeter_extrusion_width",
        initial_layer_line_width: "first_layer_extrusion_width",
        sparse_infill_line_width: "infill_extrusion_width",
        internal_solid_infill_line_width: "solid_infill_extrusion_width",
        top_surface_line_width: "top_infill_extrusion_width",
        support_line_width: "support_material_extrusion_width",
        enable_support: "support_material",
        support_threshold_angle: "support_material_threshold",
        support_on_build_plate_only: "support_material_buildplate_only",
        support_object_xy_distance: "support_material_xy_spacing",
        support_top_z_distance: "support_material_contact_distance",
        raft_layers: "raft_layers",
        brim_width: "brim_width",
        brim_type: "brim_type",
        skirt_loops: "skirts",
        skirt_distance: "skirt_distance",
        skirt_height: "skirt_height",
        detect_thin_wall: "thin_walls",
        wall_generator: "perimeter_generator",
        infill_wall_overlap: "infill_overlap",
        infill_direction: "fill_angle",
        ironing_type: "ironing",
        ironing_flow: "ironing_flowrate",
        ironing_spacing: "ironing_spacing",
        filament_colour: "filament_colour",
        filament_type: "filament_type",
        filament_diameter: "filament_diameter",
        filament_density: "filament_density",
        filament_flow_ratio: "extrusion_multiplier",
        filament_max_volumetric_speed: "filament_max_volumetric_speed",
        nozzle_temperature: "temperature",
        nozzle_temperature_initial_layer: "first_layer_temperature",
        hot_plate_temp: "bed_temperature",
        hot_plate_temp_initial_layer: "first_layer_bed_temperature",
        fan_max_speed: "max_fan_speed",
        fan_min_speed: "min_fan_speed",
        retraction_length: "retract_length",
        retraction_speed: "retract_speed",
        elefant_foot_compensation: "elefant_foot_compensation",
        resolution: "resolution",
        spiral_mode: "spiral_vase",
        ensure_vertical_shell_thickness: "ensure_vertical_shell_thickness",
        top_surface_pattern: "top_fill_pattern",
        bottom_surface_pattern: "bottom_fill_pattern",
        support_interface_pattern: "support_material_interface_pattern",
        support_base_pattern: "support_material_pattern",
        support_interface_top_layers: "support_material_interface_layers",
        tree_support_branch_angle: "support_tree_angle",
        tree_support_branch_diameter: "support_tree_branch_diameter",
        tree_support_branch_distance: "support_tree_branch_distance"
    };

    const PATTERN_MAP = {
        crosshatch: "grid",
        "zig-zag": "zigzag",
        zigzag: "zigzag"
    };

    const STRIP_SETTING_KEYS = new Set([
        "printer_model",
        "printer_settings_id",
        "printer_variant",
        "printer_notes",
        "printer_structure",
        "printer_technology",
        "printer_extruder_id",
        "printer_extruder_variant",
        "print_compatible_printers",
        "upward_compatible_machine",
        "printable_area",
        "printable_height",
        "bed_exclude_area",
        "bed_custom_model",
        "bed_custom_texture",
        "gcode_flavor",
        "host_type",
        "printhost_authorization_type",
        "printhost_ssl_ignore_revoke",
        "scan_first_layer",
        "silent_mode",
        "thumbnail_size",
        "default_print_profile",
        "default_filament_profile",
        "print_settings_id",
        "from",
        "filename_format",
        "extruder_printable_area",
        "extruder_printable_height",
        "head_wrap_detect_zone",
        "wrapping_exclude_area",
        "nozzle_type",
        "nozzle_volume",
        "nozzle_volume_type",
        "nozzle_height",
        "auxiliary_fan",
        "extruder_ams_count",
        "extruder_type",
        "extruder_variant_list",
        "extruder_max_nozzle_count",
        "extruder_nozzle_stats",
        "extruder_offset",
        "extruder_clearance_dist_to_rod",
        "extruder_clearance_height_to_lid",
        "extruder_clearance_height_to_rod",
        "extruder_clearance_max_radius",
        "physical_extruder_map",
        "print_extruder_id",
        "print_extruder_variant",
        "master_extruder_id",
        "has_filament_switcher",
        "default_nozzle_volume_type",
        "machine_bed_mass_Y",
        "machine_hotend_change_time",
        "machine_load_filament_time",
        "machine_max_printed_mass",
        "machine_max_force_Y",
        "machine_prepare_compensation_time",
        "machine_switch_extruder_time",
        "machine_unload_filament_time",
        "template_custom_gcode",
        "post_process",
        "curr_bed_type",
        "filament_settings_id",
        "filament_ids",
        "filament_extruder_compatibility",
        "filament_extruder_variant",
        "filament_map",
        "filament_map_mode",
        "filament_volume_map",
        "filament_nozzle_map",
        "use_relative_e_distances",
        "use_firmware_retraction",
        "use_volumetric_e",
        "default_ams_type"
    ]);

    const FILAMENT_SLOT_KEYS = new Set([
        "wall_filament",
        "solid_infill_filament",
        "sparse_infill_filament",
        "support_filament",
        "support_interface_filament"
    ]);

    const VERTICAL_SHELL_MAP = {
        enabled: "ensure_all",
        "1": "ensure_all",
        true: "ensure_all",
        disabled: "disabled",
        "0": "disabled",
        false: "disabled",
        none: "disabled",
        partial: "ensure_moderate"
    };

    const FILAMENT_ARRAY_KEYS = new Set([
        "filament_colour",
        "filament_type",
        "filament_diameter",
        "filament_density",
        "filament_flow_ratio",
        "filament_max_volumetric_speed",
        "nozzle_temperature",
        "nozzle_temperature_initial_layer",
        "hot_plate_temp",
        "hot_plate_temp_initial_layer",
        "fan_max_speed",
        "fan_min_speed",
        "retraction_length",
        "retraction_speed"
    ]);

    function normalizePath(p) {
        return String(p || "")
            .replace(/\\/g, "/")
            .replace(/^\/+/, "");
    }

    function pathKey(p) {
        return normalizePath(p).toLowerCase();
    }

    function escapeXml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function parseAttrs(attrStr) {
        const attrs = {};
        const re = /([:\w.-]+)\s*=\s*"([^"]*)"/g;
        let m;
        while ((m = re.exec(attrStr || ""))) {
            attrs[m[1]] = m[2];
        }
        return attrs;
    }

    function firstValue(value) {
        if (Array.isArray(value)) return value[0];
        return value;
    }

    function asArray(value) {
        if (value == null) return [];
        return Array.isArray(value) ? value : [value];
    }

    function slic3rSerialize(value) {
        if (Array.isArray(value)) return value.map(String).join(";");
        if (value === true) return "1";
        if (value === false) return "0";
        return String(value);
    }

    function mapFillPattern(pattern) {
        if (pattern == null) return pattern;
        const key = String(pattern).toLowerCase();
        return PATTERN_MAP[key] || pattern;
    }

    function shouldStripSettingKey(key) {
        if (STRIP_SETTING_KEYS.has(key)) return true;
        if (key.startsWith("machine_max_") || key.startsWith("machine_min_")) return true;
        if (key.endsWith("_gcode")) return true;
        if (key.startsWith("printhost_")) return true;
        return false;
    }

    function isSentinelSettingToken(value) {
        if (value == null) return true;
        const s = String(value).trim().toLowerCase();
        return s === "nil" || s === "-1";
    }

    function sanitizeSettingValue(value) {
        if (Array.isArray(value)) {
            if (!value.length || value.some(isSentinelSettingToken)) return undefined;
            return value;
        }
        if (isSentinelSettingToken(value)) return undefined;
        return value;
    }

    function isUnsetFilamentSlot(key, value) {
        if (!FILAMENT_SLOT_KEYS.has(key)) return false;
        const n = Number(firstValue(value));
        return !Number.isFinite(n) || n < 1;
    }

    function mapVerticalShellThickness(value) {
        const raw = String(firstValue(value)).trim().toLowerCase();
        return VERTICAL_SHELL_MAP[raw] || firstValue(value);
    }

    function extractBambuSettings(config) {
        if (!config || typeof config !== "object" || Array.isArray(config)) return {};
        if (config.process_settings && typeof config.process_settings === "object") {
            const nested = config.process_settings["1"] || config.process_settings[1];
            if (nested && typeof nested === "object") {
                return { ...config, ...nested };
            }
        }
        return config;
    }

    function mapSettingsToSlic3r(bambuSettings) {
        const out = {};
        if (!bambuSettings) return out;

        for (const [bambuKey, slic3rKey] of Object.entries(BAMBU_TO_SLIC3R)) {
            if (bambuSettings[bambuKey] == null || bambuSettings[bambuKey] === "") continue;
            let value = bambuSettings[bambuKey];

            if (bambuKey === "sparse_infill_pattern") value = mapFillPattern(firstValue(value));
            if (bambuKey === "enable_support" || bambuKey === "detect_thin_wall" || bambuKey === "spiral_mode" || bambuKey === "support_on_build_plate_only") {
                const raw = firstValue(value);
                value = raw === true || raw === "1" || raw === 1 || String(raw).toLowerCase() === "true" ? "1" : "0";
            }
            if (bambuKey === "ironing_type") {
                const raw = String(firstValue(value)).toLowerCase();
                value = raw && raw !== "no ironing" && raw !== "none" ? "1" : "0";
            }
            if (bambuKey === "wall_generator") {
                value = String(firstValue(value)).toLowerCase() === "arachne" ? "arachne" : "classic";
            }
            if (bambuKey === "ensure_vertical_shell_thickness") {
                value = mapVerticalShellThickness(value);
            }
            if (FILAMENT_ARRAY_KEYS.has(bambuKey)) {
                value = asArray(value);
            } else if (Array.isArray(value)) {
                value = firstValue(value);
            }

            out[slic3rKey] = value;
        }
        syncExtruderColours(out);
        return out;
    }

    function syncExtruderColours(out) {
        const filaments = asArray(out.filament_colour);
        const extruders = asArray(out.extruder_colour);
        if (filaments.length && filaments.length > extruders.length) {
            out.extruder_colour = filaments;
        }
    }

    function sanitizeProjectSettings(config) {
        const merged = extractBambuSettings(config);
        const out = {};
        for (const [key, value] of Object.entries(merged)) {
            if (shouldStripSettingKey(key)) continue;
            if (isUnsetFilamentSlot(key, value)) continue;
            const cleaned = sanitizeSettingValue(value);
            if (cleaned === undefined) continue;
            out[key] = key === "ensure_vertical_shell_thickness" ? mapVerticalShellThickness(cleaned) : cleaned;
        }
        syncExtruderColours(out);
        return out;
    }

    function buildSlic3rConfig(mapped) {
        const lines = ["; generated by 3MF Sanitizer", ""];
        for (const key of Object.keys(mapped).sort()) {
            lines.push("; " + key + " = " + slic3rSerialize(mapped[key]));
        }
        return lines.join("\n") + "\n";
    }

    function parseModelSettings(xml) {
        const objects = {};
        if (!xml) return objects;
        const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
        let m;
        while ((m = objectRe.exec(xml))) {
            const id = parseAttrs(m[1]).id;
            if (!id) continue;
            const body = m[2];
            const partAt = body.search(/<part\b/i);
            const objectHead = partAt >= 0 ? body.slice(0, partAt) : body;
            const meta = {};
            const metaRe = /<metadata\b([^>]*)\/?>/gi;
            let mm;
            while ((mm = metaRe.exec(objectHead))) {
                const attrs = parseAttrs(mm[1]);
                if (attrs.key) meta[attrs.key] = attrs.value;
            }
            const parts = [];
            const partRe = /<part\b([^>]*)>([\s\S]*?)<\/part>/gi;
            let p;
            while ((p = partRe.exec(body))) {
                const partAttrs = parseAttrs(p[1]);
                const partMeta = {};
                const partMetaRe = /<metadata\b([^>]*)\/?>/gi;
                let pm;
                while ((pm = partMetaRe.exec(p[2]))) {
                    const attrs = parseAttrs(pm[1]);
                    if (attrs.key) partMeta[attrs.key] = attrs.value;
                }
                parts.push({
                    id: partAttrs.id,
                    name: partMeta.name || "",
                    extruder: partMeta.extruder ? parseInt(partMeta.extruder, 10) : (meta.extruder ? parseInt(meta.extruder, 10) : 1)
                });
            }
            objects[id] = {
                id,
                name: meta.name || "",
                extruder: meta.extruder ? parseInt(meta.extruder, 10) : 1,
                parts
            };
        }
        return objects;
    }

    function parsePlates(xml) {
        const plates = [];
        if (!xml) return plates;
        const plateRe = /<plate>([\s\S]*?)<\/plate>/gi;
        let m;
        while ((m = plateRe.exec(xml))) {
            const body = m[1];
            const instAt = body.search(/<model_instance/i);
            const head = instAt >= 0 ? body.slice(0, instAt) : body;
            const meta = {};
            const metaRe = /<metadata\b([^>]*)\/?>/gi;
            let mm;
            while ((mm = metaRe.exec(head))) {
                const attrs = parseAttrs(mm[1]);
                if (attrs.key) meta[attrs.key] = attrs.value;
            }
            const instances = [];
            const instRe = /<model_instance>([\s\S]*?)<\/model_instance>/gi;
            let im;
            while ((im = instRe.exec(body))) {
                const imeta = {};
                const ime = /<metadata\b([^>]*)\/?>/gi;
                let k;
                while ((k = ime.exec(im[1]))) {
                    const attrs = parseAttrs(k[1]);
                    if (attrs.key) imeta[attrs.key] = attrs.value;
                }
                if (!imeta.object_id) continue;
                instances.push({
                    objectId: String(imeta.object_id),
                    instanceId: imeta.instance_id != null ? parseInt(imeta.instance_id, 10) || 0 : 0,
                    identifyId: imeta.identify_id || ""
                });
            }
            plates.push({
                id: meta.plater_id || String(plates.length + 1),
                name: meta.plater_name || "",
                instances
            });
        }
        return plates;
    }

    function assignInstancesToPlates(sourcePlates, emitted) {
        const remaining = emitted.slice();
        const take = (sourceObjectId, sourceInstanceId) => {
            const idx = remaining.findIndex(
                (item) =>
                    String(item.sourceObjectId) === String(sourceObjectId) &&
                    Number(item.sourceInstanceId) === Number(sourceInstanceId)
            );
            if (idx < 0) return null;
            return remaining.splice(idx, 1)[0];
        };

        let identify = 1;
        const plates = [];
        for (const plate of sourcePlates || []) {
            const instances = [];
            for (const inst of plate.instances || []) {
                const hit = take(inst.objectId, inst.instanceId);
                if (!hit) continue;
                instances.push({
                    objectId: hit.objectid,
                    instanceId: hit.outInstanceId,
                    identifyId: inst.identifyId || String(identify++)
                });
            }
            if (instances.length) {
                plates.push({
                    id: String(plates.length + 1),
                    name: plate.name || "",
                    instances
                });
            }
        }

        if (!plates.length && remaining.length) {
            plates.push({ id: "1", name: "", instances: [] });
        }
        if (remaining.length && plates.length) {
            for (const item of remaining) {
                plates[plates.length - 1].instances.push({
                    objectId: item.objectid,
                    instanceId: item.outInstanceId,
                    identifyId: String(identify++)
                });
            }
        }
        return plates;
    }

    function extractModelMetadata(xml) {
        const metas = [];
        const modelOpen = xml.match(/<model\b[^>]*>/i);
        if (!modelOpen) return metas;
        const after = xml.slice(xml.indexOf(modelOpen[0]) + modelOpen[0].length);
        const resourcesAt = after.search(/<resources[\s>]/i);
        const head = resourcesAt >= 0 ? after.slice(0, resourcesAt) : after;
        const startRe = /<metadata\b/gi;
        let start;
        while ((start = startRe.exec(head))) {
            const afterName = start.index + start[0].length;
            const rest = head.slice(afterName);
            const endAttrs = rest.search(/\/?>/);
            if (endAttrs < 0) break;
            const attrStr = rest.slice(0, endAttrs);
            const selfClose = rest[endAttrs] === "/";
            let cursor = afterName + endAttrs + (selfClose ? 2 : 1);
            let text = "";
            if (!selfClose) {
                const tail = head.slice(cursor);
                const closeAt = tail.search(/<\/metadata>/i);
                const nextMeta = tail.search(/<metadata\b/i);
                if (closeAt >= 0 && (nextMeta < 0 || closeAt < nextMeta)) {
                    text = tail.slice(0, closeAt);
                    cursor += closeAt + "</metadata>".length;
                }
            }
            startRe.lastIndex = cursor;
            metas.push({ attrs: parseAttrs(attrStr), text });
        }
        return metas;
    }

    function formatCoreMetadata(name, text) {
        const value = text == null ? "" : String(text).trim();
        if (!value) return ` <metadata name="${escapeXml(name)}" />`;
        return ` <metadata name="${escapeXml(name)}">${escapeXml(value)}</metadata>`;
    }

    function extractObjects(xml) {
        const objects = [];
        const re = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
        let m;
        while ((m = re.exec(xml))) {
            const attrs = parseAttrs(m[1]);
            const body = m[2];
            objects.push({
                id: attrs.id,
                attrs,
                body,
                hasMesh: /<mesh[\s>]/i.test(body),
                components: extractComponents(body)
            });
        }
        return objects;
    }

    function extractComponents(body) {
        const comps = [];
        const re = /<component\b([^>]*)\/?>/gi;
        let m;
        while ((m = re.exec(body))) {
            const attrs = parseAttrs(m[1]);
            comps.push({
                objectid: attrs.objectid,
                path: attrs["p:path"] || attrs.path || null,
                transform: attrs.transform || null
            });
        }
        return comps;
    }

    function extractBuildItems(xml) {
        const items = [];
        const instanceCount = {};
        const re = /<item\b([^>]*)\/?>/gi;
        let m;
        while ((m = re.exec(xml))) {
            const attrs = parseAttrs(m[1]);
            if (!attrs.objectid) continue;
            const n = instanceCount[attrs.objectid] || 0;
            instanceCount[attrs.objectid] = n + 1;
            items.push({
                objectid: attrs.objectid,
                transform: attrs.transform || null,
                printable: attrs.printable,
                instanceId: n
            });
        }
        return items;
    }

    function parseTransform(str) {
        if (!str) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        const n = String(str)
            .trim()
            .split(/[\s,]+/)
            .map(Number);
        if (n.length !== 12 || n.some((x) => Number.isNaN(x))) {
            return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        }
        return n;
    }

    function multiplyTransform(aStr, bStr) {
        const A = parseTransform(aStr);
        const B = parseTransform(bStr);
        // 3x3 row-major + translation; column-vector compose: out = A * B
        const a00 = A[0], a01 = A[1], a02 = A[2], atx = A[9];
        const a10 = A[3], a11 = A[4], a12 = A[5], aty = A[10];
        const a20 = A[6], a21 = A[7], a22 = A[8], atz = A[11];
        const b00 = B[0], b01 = B[1], b02 = B[2], btx = B[9];
        const b10 = B[3], b11 = B[4], b12 = B[5], bty = B[10];
        const b20 = B[6], b21 = B[7], b22 = B[8], btz = B[11];
        return [
            a00 * b00 + a01 * b10 + a02 * b20,
            a00 * b01 + a01 * b11 + a02 * b21,
            a00 * b02 + a01 * b12 + a02 * b22,
            a10 * b00 + a11 * b10 + a12 * b20,
            a10 * b01 + a11 * b11 + a12 * b21,
            a10 * b02 + a11 * b12 + a12 * b22,
            a20 * b00 + a21 * b10 + a22 * b20,
            a20 * b01 + a21 * b11 + a22 * b21,
            a20 * b02 + a21 * b12 + a22 * b22,
            a00 * btx + a01 * bty + a02 * btz + atx,
            a10 * btx + a11 * bty + a12 * btz + aty,
            a20 * btx + a21 * bty + a22 * btz + atz
        ];
    }

    function formatTransform(m) {
        return m
            .map((n) => {
                if (Object.is(n, -0)) return "0";
                const r = Math.round(n * 1e7) / 1e7;
                return String(r);
            })
            .join(" ");
    }

    function rewriteObjectBody(body, resolveComponentId) {
        return body.replace(/<component\b([^>]*)\/?>/gi, (full, attrStr) => {
            const attrs = parseAttrs(attrStr);
            const newId = resolveComponentId(attrs);
            if (!newId) return "";
            const transform = attrs.transform ? ` transform="${attrs.transform}"` : "";
            return `<component objectid="${newId}"${transform}/>`;
        });
    }

    function stripProductionAttrs(attrStr) {
        return String(attrStr || "")
            .replace(/\s+p:[\w.-]+\s*=\s*"[^"]*"/g, "")
            .replace(/\s+type\s*=\s*"other"/i, ' type="model"');
    }

    function countPaintColors(xml) {
        const matches = String(xml).match(/paint_color="/g);
        return matches ? matches.length : 0;
    }

    function countTriangles(xml) {
        const matches = String(xml).match(/<triangle\b/g);
        return matches ? matches.length : 0;
    }

    function countVertices(xml) {
        const matches = String(xml).match(/<vertex\b/g);
        return matches ? matches.length : 0;
    }

    function displayColor(hex) {
        const raw = String(hex || "#808080").replace(/^#/, "");
        if (raw.length === 8) return "#" + raw.toUpperCase();
        if (raw.length === 6) return "#" + raw.toUpperCase() + "FF";
        return "#808080FF";
    }

    function hexToBitstream(hex) {
        const bits = [];
        const s = String(hex || "").toUpperCase();
        for (let i = s.length - 1; i >= 0; i--) {
            const ch = s[i];
            let dec = 0;
            if (ch >= "0" && ch <= "9") dec = ch.charCodeAt(0) - 48;
            else if (ch >= "A" && ch <= "F") dec = 10 + ch.charCodeAt(0) - 65;
            else continue;
            for (let b = 0; b < 4; b++) bits.push((dec & (1 << b)) !== 0);
        }
        return bits;
    }

    function encodePaintState(state) {
        const n = Number(state);
        if (!Number.isInteger(n) || n <= 0) return "";
        if (n <= 2) {
            const nibble = ((n & 1) << 2) | (((n >> 1) & 1) << 3);
            return nibble.toString(16).toUpperCase();
        }
        const extra = Math.min(n - 3, 15);
        return extra.toString(16).toUpperCase() + "C";
    }

    function decodePaintState(hex) {
        if (!hex) return 0;
        const bits = hexToBitstream(hex);
        let pos = 0;
        const read2 = () => {
            const a = bits[pos++] ? 1 : 0;
            const b = bits[pos++] ? 2 : 0;
            return a | b;
        };
        const read4 = () => {
            let n = 0;
            for (let i = 0; i < 4; i++) {
                if (bits[pos++]) n |= 1 << i;
            }
            return n;
        };
        const decodeNode = () => {
            if (pos >= bits.length) return 0;
            const splitSides = read2();
            if (splitSides === 0) {
                const xx = read2();
                if (xx === 3) return read4() + 3;
                return xx;
            }
            read2();
            const childStates = [];
            for (let c = splitSides; c >= 0; c--) childStates.push(decodeNode());
            const counts = new Map();
            for (const state of childStates) {
                counts.set(state, (counts.get(state) || 0) + 1);
            }
            let best = 0;
            let bestN = -1;
            for (const [state, n] of counts) {
                if (n > bestN || (n === bestN && state !== 0 && best === 0)) {
                    best = state;
                    bestN = n;
                }
            }
            return best;
        };
        return decodeNode();
    }

    function stateToMaterialIndex(state, defaultExtruder, colorCount) {
        let idx = !state || state <= 0 ? Math.max(0, (defaultExtruder || 1) - 1) : state - 1;
        if (colorCount > 0) idx = Math.min(idx, colorCount - 1);
        return idx;
    }

    function applyTriangleMaterials(body, materialsId, defaultExtruder, colorCount) {
        return String(body).replace(/<triangle\b([^>]*)\/?>/gi, (full, attrStr) => {
            const attrs = parseAttrs(attrStr);
            const paint = attrs.paint_color || attrs["slic3rpe:mmu_segmentation"] || "";
            const state = paint ? decodePaintState(paint) : 0;
            const p1 = stateToMaterialIndex(state, defaultExtruder, colorCount);
            let out = `<triangle v1="${attrs.v1}" v2="${attrs.v2}" v3="${attrs.v3}" pid="${materialsId}" p1="${p1}"`;
            if (paint) {
                out += ` paint_color="${escapeXml(paint)}" slic3rpe:mmu_segmentation="${escapeXml(paint)}"`;
            }
            if (attrs.paint_supports) out += ` paint_supports="${escapeXml(attrs.paint_supports)}"`;
            if (attrs.paint_seam) out += ` paint_seam="${escapeXml(attrs.paint_seam)}"`;
            out += "/>";
            return out;
        });
    }

    function buildModelSettingsConfig(objects, plates, assembleItems) {
        const chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
        const seen = new Set();
        for (const obj of objects) {
            if (seen.has(obj.id)) continue;
            seen.add(obj.id);
            chunks.push(`  <object id="${obj.id}">`);
            if (obj.name) chunks.push(`    <metadata key="name" value="${escapeXml(obj.name)}"/>`);
            chunks.push(`    <metadata key="extruder" value="${obj.extruder || 1}"/>`);
            const parts = obj.volumes && obj.volumes.length ? obj.volumes : [{ name: obj.name, extruder: obj.extruder || 1 }];
            parts.forEach((part, index) => {
                chunks.push(`    <part id="${index + 1}" subtype="normal_part">`);
                if (part.name) chunks.push(`      <metadata key="name" value="${escapeXml(part.name)}"/>`);
                chunks.push(`      <metadata key="extruder" value="${part.extruder || obj.extruder || 1}"/>`);
                chunks.push("    </part>");
            });
            chunks.push("  </object>");
        }
        const plateList = plates && plates.length ? plates : [];
        for (const plate of plateList) {
            chunks.push("  <plate>");
            chunks.push(`    <metadata key="plater_id" value="${escapeXml(plate.id || "1")}"/>`);
            chunks.push(`    <metadata key="plater_name" value="${escapeXml(plate.name || "")}"/>`);
            chunks.push(`    <metadata key="locked" value="false"/>`);
            for (const inst of plate.instances || []) {
                chunks.push("    <model_instance>");
                chunks.push(`      <metadata key="object_id" value="${inst.objectId}"/>`);
                chunks.push(`      <metadata key="instance_id" value="${inst.instanceId != null ? inst.instanceId : 0}"/>`);
                chunks.push(`      <metadata key="identify_id" value="${escapeXml(String(inst.identifyId || "1"))}"/>`);
                chunks.push("    </model_instance>");
            }
            chunks.push("  </plate>");
        }
        const assemble = assembleItems && assembleItems.length ? assembleItems : [];
        if (assemble.length) {
            chunks.push("  <assemble>");
            for (const item of assemble) {
                const transform = item.transform || "1 0 0 0 1 0 0 0 1 0 0 0";
                chunks.push(
                    `   <assemble_item object_id="${item.objectid}" instance_id="${item.outInstanceId != null ? item.outInstanceId : 0}" transform="${escapeXml(transform)}" offset="0 0 0" />`
                );
            }
            chunks.push("  </assemble>");
        }
        chunks.push("</config>", "");
        return chunks.join("\n");
    }

    function shouldDropEntry(relativePath) {
        const p = pathKey(relativePath);
        if (p.includes(".gcode")) return true;
        if (p.includes("slice_info")) return true;
        if (p.startsWith("3d/objects/")) return true;
        if (p.startsWith("3d/_rels/")) return true;
        if (p.startsWith("auxiliaries/")) return true;
        if (p.startsWith("metadata/_rels/")) return true;
        if (p.includes("custom_gcode")) return true;
        if (p.includes("filament_settings")) return true;
        if (p.includes("filament_sequence")) return true;
        if (p.includes("cut_information")) return true;
        if (/plate_\d+\.json$/.test(p)) return true;
        if (p.endsWith("metadata/project_settings.config")) return true;
        if (p.endsWith("metadata/model_settings.config")) return true;
        if (p === "[content_types].xml" || p === "_rels/.rels") return true;
        if (p === "3d/3dmodel.model") return true;
        return false;
    }

    function findZipFile(filesByKey, wanted) {
        const key = pathKey(wanted);
        if (filesByKey[key]) return filesByKey[key];
        const noSlash = key.replace(/^\/+/, "");
        return filesByKey[noSlash] || null;
    }

    function indexZipFiles(zip) {
        const filesByKey = {};
        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            filesByKey[pathKey(relativePath)] = { relativePath, entry };
        }
        return filesByKey;
    }

    function collectModelFiles(filesByKey) {
        const models = [];
        for (const rec of Object.values(filesByKey)) {
            if (pathKey(rec.relativePath).endsWith(".model")) models.push(rec);
        }
        return models;
    }

    function parseAllModels(modelXmlByPath) {
        const parsed = {};
        for (const [p, xml] of Object.entries(modelXmlByPath)) {
            parsed[pathKey(p)] = {
                path: normalizePath(p),
                objects: extractObjects(xml),
                buildItems: extractBuildItems(xml),
                metadata: extractModelMetadata(xml),
                xml
            };
        }
        return parsed;
    }

    function getObject(parsedModels, filePath, objectId) {
        const file = parsedModels[pathKey(filePath)];
        if (!file) return null;
        return file.objects.find((o) => String(o.id) === String(objectId)) || null;
    }

    function resolveTarget(parsedModels, filePath, objectId, transform, seen) {
        const mark = pathKey(filePath) + "::" + objectId;
        if (seen.has(mark)) return null;
        seen.add(mark);
        const obj = getObject(parsedModels, filePath, objectId);
        if (!obj) return null;
        if (obj.hasMesh && obj.components.length === 0) {
            return { kind: "mesh", obj, filePath, objectId, transform };
        }
        if (!obj.hasMesh && obj.components.length === 1) {
            const c = obj.components[0];
            const childPath = c.path ? normalizePath(c.path) : filePath;
            return resolveTarget(
                parsedModels,
                childPath,
                c.objectid,
                formatTransform(multiplyTransform(transform, c.transform)),
                seen
            );
        }
        return { kind: "assembly", obj, filePath, objectId, transform };
    }

    function buildBasematerialsXml(id, colors, types) {
        if (!colors.length) {
            colors = ["#808080"];
            types = ["Filament"];
        }
        const bases = colors
            .map((c, i) => {
                const name = escapeXml((types[i] || "Filament") + " " + (i + 1));
                return `  <base name="${name}" displaycolor="${displayColor(c)}"/>`;
            })
            .join("\n");
        return `<basematerials id="${id}">\n${bases}\n </basematerials>`;
    }

    function buildSlic3rModelConfig(objects) {
        const chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
        for (const obj of objects) {
            chunks.push(` <object id="${obj.id}" instancescount="1">`);
            if (obj.name) {
                chunks.push(`  <metadata type="object" key="name" value="${escapeXml(obj.name)}"/>`);
            }
            if (obj.extruder) {
                chunks.push(`  <metadata type="object" key="extruder" value="${obj.extruder}"/>`);
            }
            const volumes = obj.volumes && obj.volumes.length ? obj.volumes : [];
            for (const vol of volumes) {
                chunks.push(`  <volume firstid="${vol.firstid}" lastid="${vol.lastid}">`);
                if (vol.name) {
                    chunks.push(`   <metadata type="volume" key="name" value="${escapeXml(vol.name)}"/>`);
                }
                chunks.push(`   <metadata type="volume" key="extruder" value="${vol.extruder || obj.extruder || 1}"/>`);
                chunks.push("  </volume>");
            }
            chunks.push(" </object>");
        }
        chunks.push("</config>", "");
        return chunks.join("\n");
    }

    function buildFlattenedModel({ parsedModels, rootPath, modelSettings, bambuSettings, mappedSettings, plates }) {
        const root = parsedModels[pathKey(rootPath)];
        if (!root) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        const colors = asArray(bambuSettings.filament_colour);
        const types = asArray(bambuSettings.filament_type);
        const materialsId = 1;
        let nextId = 2;

        const meshKeyToId = new Map();
        const emittedMeshes = [];
        const emittedAssemblies = [];
        const buildItems = [];
        const objectMeta = [];
        const logs = [];

        function meshKey(filePath, objectId) {
            return pathKey(filePath) + "::" + objectId;
        }

        function ensureMesh(filePath, objectId, extruder) {
            const key = meshKey(filePath, objectId);
            const existing = meshKeyToId.get(key);
            if (existing) {
                if (existing.extruder && extruder && existing.extruder !== extruder) {
                    const cloneId = nextId++;
                    const src = getObject(parsedModels, filePath, objectId);
                    emittedMeshes.push({
                        id: cloneId,
                        body: src.body,
                        source: key,
                        extruder
                    });
                    return cloneId;
                }
                return existing.id;
            }
            const src = getObject(parsedModels, filePath, objectId);
            if (!src || !src.hasMesh) return null;
            const id = nextId++;
            meshKeyToId.set(key, { id, extruder });
            emittedMeshes.push({ id, body: src.body, source: key, extruder });
            return id;
        }

        function partInfo(wrapper, componentObjectId, componentIndex) {
            const parts = wrapper.parts || [];
            return (
                parts.find((p) => String(p.id) === String(componentObjectId)) ||
                parts[componentIndex] ||
                { name: wrapper.name || "", extruder: wrapper.extruder || 1 }
            );
        }

        function rememberObjectMeta(id, name, extruder, volumes) {
            if (objectMeta.some((o) => o.id === id)) return;
            objectMeta.push({ id, name: name || "", extruder, volumes: volumes || [] });
        }

        function emitPlacedMesh({ filePath, objectId, transform, extruder, name, printable, volumes, sourceObjectId, sourceInstanceId }) {
            const newId = ensureMesh(filePath, objectId, extruder);
            if (!newId) return;
            buildItems.push({
                objectid: newId,
                transform,
                printable: printable != null ? printable : "1",
                sourceObjectId: sourceObjectId != null ? String(sourceObjectId) : String(objectId),
                sourceInstanceId: sourceInstanceId != null ? sourceInstanceId : 0
            });
            rememberObjectMeta(newId, name, extruder, volumes || []);
        }

        function gatherParts(node, wrapper, localTransform) {
            if (!node) return [];
            if (node.kind === "mesh") {
                return [{
                    name: wrapper.name || "",
                    extruder: wrapper.extruder || 1,
                    body: node.obj.body,
                    localTransform: localTransform || "1 0 0 0 1 0 0 0 1 0 0 0"
                }];
            }
            const out = [];
            (node.obj.components || []).forEach((c, index) => {
                const info = partInfo(wrapper, c.objectid, index);
                const childPath = c.path ? normalizePath(c.path) : node.filePath;
                const childLocal = formatTransform(multiplyTransform(localTransform, c.transform));
                const child = resolveTarget(parsedModels, childPath, c.objectid, c.transform, new Set());
                out.push(...gatherParts(child, { name: info.name, extruder: info.extruder, parts: [] }, childLocal));
            });
            return out;
        }

        const items = root.buildItems.length
            ? root.buildItems
            : root.objects.map((o) => ({ objectid: o.id, transform: null, printable: "1", instanceId: 0 }));

        if (!items.length) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        for (const item of items) {
            const wrapper = modelSettings[String(item.objectid)] || {};
            const resolved = resolveTarget(parsedModels, rootPath, item.objectid, item.transform, new Set());
            if (!resolved) {
                logs.push("Skipped unresolved build item objectid=" + item.objectid);
                continue;
            }
            const printable = item.printable != null ? item.printable : "1";
            if (resolved.kind === "mesh") {
                emitPlacedMesh({
                    filePath: resolved.filePath,
                    objectId: resolved.objectId,
                    transform: resolved.transform,
                    extruder: wrapper.extruder || 1,
                    name: wrapper.name || "",
                    printable,
                    sourceObjectId: item.objectid,
                    sourceInstanceId: item.instanceId
                });
                continue;
            }
            const parts = gatherParts(resolved, wrapper, "1 0 0 0 1 0 0 0 1 0 0 0");
            if (!parts.length) continue;
            const merged = mergePartsToMesh(parts, materialsId, colors);
            const id = nextId++;
            emittedMeshes.push({
                id,
                body: merged.body,
                extruder: wrapper.extruder || parts[0].extruder,
                merged: true
            });
            buildItems.push({
                objectid: id,
                transform: item.transform,
                printable,
                sourceObjectId: String(item.objectid),
                sourceInstanceId: item.instanceId != null ? item.instanceId : 0
            });
            rememberObjectMeta(
                id,
                wrapper.name || parts[0].name || "",
                wrapper.extruder || parts[0].extruder,
                merged.volumes
            );
            logs.push(
                `Kept merged assembly "${wrapper.name || "object"}" with ${parts.length} colored parts as one object.`
            );
        }

        if (!emittedMeshes.length && !emittedAssemblies.length) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        const keepMetaNames = new Set([
            "Title",
            "Description",
            "Designer",
            "Copyright",
            "License",
            "CreationDate",
            "ModificationDate"
        ]);
        const metadataXml = [];
        for (const meta of root.metadata) {
            const name = meta.attrs.name;
            if (!name || !keepMetaNames.has(name)) continue;
            metadataXml.push(formatCoreMetadata(name, meta.text));
        }
        metadataXml.push(` <metadata name="Application">3MF Sanitizer</metadata>`);
        for (const [key, value] of Object.entries(mappedSettings)) {
            metadataXml.push(
                ` <metadata name="slic3r:${escapeXml(key)}">${escapeXml(slic3rSerialize(value))}</metadata>`
            );
        }

        const pindexFor = (extruder) => {
            if (!colors.length) return 0;
            const idx = Math.max(0, (extruder || 1) - 1);
            return Math.min(idx, colors.length - 1);
        };

        const resourceXml = [];
        resourceXml.push(" " + buildBasematerialsXml(materialsId, colors, types));

        for (const mesh of emittedMeshes) {
            const cleanedBody = mesh.merged
                ? mesh.body
                : applyTriangleMaterials(
                    rewriteObjectBody(mesh.body, () => null).replace(/p:[\w.-]+\s*=\s*"[^"]*"\s*/g, ""),
                    materialsId,
                    mesh.extruder,
                    colors.length
                );
            const pindex = pindexFor(mesh.extruder);
            resourceXml.push(
                ` <object id="${mesh.id}" type="model" pid="${materialsId}" pindex="${pindex}">${cleanedBody}</object>`
            );
        }
        for (const assem of emittedAssemblies) {
            const pindex = pindexFor(assem.extruder);
            resourceXml.push(
                ` <object id="${assem.id}" type="model" pid="${materialsId}" pindex="${pindex}">${assem.body}</object>`
            );
        }

        const buildXml = buildItems
            .map((item) => {
                const t = item.transform ? ` transform="${item.transform}"` : "";
                const printable = item.printable != null ? ` printable="${item.printable}"` : "";
                return `  <item objectid="${item.objectid}"${t}${printable}/>`;
            })
            .join("\n");

        const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">`,
            metadataXml.join("\n"),
            " <resources>",
            resourceXml.join("\n"),
            " </resources>",
            " <build>",
            buildXml,
            " </build>",
            "</model>",
            ""
        ].join("\n");

        const instanceCount = {};
        for (const item of buildItems) {
            const n = instanceCount[item.objectid] || 0;
            item.outInstanceId = n;
            instanceCount[item.objectid] = n + 1;
        }
        const assignedPlates = assignInstancesToPlates(plates, buildItems);
        if (assignedPlates.length > 1) {
            logs.push(`Preserved ${assignedPlates.length} plates with ${buildItems.length} object instance(s).`);
        } else if (assignedPlates.length === 1) {
            logs.push(`Assigned ${buildItems.length} object instance(s) to plate 1.`);
        }

        return {
            xml,
            objectMeta,
            plates: assignedPlates,
            assembleItems: buildItems,
            logs,
            stats: {
                objects: emittedMeshes.length + emittedAssemblies.length,
                buildItems: buildItems.length,
                plates: assignedPlates.length,
                vertices: countVertices(xml),
                triangles: countTriangles(xml),
                paintColors: countPaintColors(xml),
                materials: colors.length || 1
            }
        };
    }

    function contentTypesXml() {
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
            ' <Default Extension="png" ContentType="image/png"/>',
            ' <Default Extension="config" ContentType="application/octet-stream"/>',
            "</Types>",
            ""
        ].join("\n");
    }

    function relsXml(hasThumbnail) {
        const rels = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${MODEL_REL}"/>`
        ];
        if (hasThumbnail) {
            rels.push(` <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="${THUMB_REL}"/>`);
        }
        rels.push("</Relationships>", "");
        return rels.join("\n");
    }

    function logLine(log, message) {
        if (typeof log === "function") log(message);
    }

    function hexToRgb01(hex) {
        const raw = displayColor(hex).replace(/^#/, "");
        return [
            parseInt(raw.slice(0, 2), 16) / 255,
            parseInt(raw.slice(2, 4), 16) / 255,
            parseInt(raw.slice(4, 6), 16) / 255
        ];
    }

    function parseMeshGeometry(body) {
        const vertices = [];
        const vRe = /<vertex\b([^>]*)\/?>/gi;
        let m;
        while ((m = vRe.exec(body || ""))) {
            const a = parseAttrs(m[1]);
            vertices.push([parseFloat(a.x) || 0, parseFloat(a.y) || 0, parseFloat(a.z) || 0]);
        }
        const triangles = [];
        const tRe = /<triangle\b([^>]*)\/?>/gi;
        while ((m = tRe.exec(body || ""))) {
            const a = parseAttrs(m[1]);
            triangles.push({
                v1: parseInt(a.v1, 10),
                v2: parseInt(a.v2, 10),
                v3: parseInt(a.v3, 10),
                paint: a.paint_color || "",
                p1: a.p1 != null && a.p1 !== "" ? parseInt(a.p1, 10) : null
            });
        }
        return { vertices, triangles };
    }

    function transformPoint(point, matrix) {
        const M = parseTransform(matrix);
        const x = point[0];
        const y = point[1];
        const z = point[2];
        return [
            M[0] * x + M[1] * y + M[2] * z + M[9],
            M[3] * x + M[4] * y + M[5] * z + M[10],
            M[6] * x + M[7] * y + M[8] * z + M[11]
        ];
    }

    function formatCoord(n) {
        if (Object.is(n, -0)) return "0";
        return String(Math.round(n * 1e7) / 1e7);
    }

    function mergePartsToMesh(parts, materialsId, colors) {
        const vertexLines = [];
        const triangleLines = [];
        const volumes = [];
        let vOffset = 0;
        let tOffset = 0;
        const paletteSize = colors.length || 1;

        for (const part of parts) {
            const geom = parseMeshGeometry(part.body);
            for (const vertex of geom.vertices) {
                const p = transformPoint(vertex, part.localTransform);
                vertexLines.push(`     <vertex x="${formatCoord(p[0])}" y="${formatCoord(p[1])}" z="${formatCoord(p[2])}"/>`);
            }
            const defaultIdx = stateToMaterialIndex(0, part.extruder, paletteSize);
            let tCount = 0;
            for (const tri of geom.triangles) {
                let idx = defaultIdx;
                if (Number.isInteger(tri.p1)) idx = Math.min(Math.max(tri.p1, 0), paletteSize - 1);
                else if (tri.paint) idx = stateToMaterialIndex(decodePaintState(tri.paint), part.extruder, paletteSize);
                const paint = tri.paint || encodePaintState(part.extruder);
                let extra = ` pid="${materialsId}" p1="${idx}"`;
                if (paint) {
                    extra += ` paint_color="${escapeXml(paint)}" slic3rpe:mmu_segmentation="${escapeXml(paint)}"`;
                }
                triangleLines.push(
                    `     <triangle v1="${tri.v1 + vOffset}" v2="${tri.v2 + vOffset}" v3="${tri.v3 + vOffset}"${extra}/>`
                );
                tCount += 1;
            }
            if (tCount > 0) {
                volumes.push({
                    name: part.name,
                    extruder: part.extruder,
                    firstid: tOffset,
                    lastid: tOffset + tCount - 1
                });
            }
            vOffset += geom.vertices.length;
            tOffset += tCount;
        }

        return {
            body:
                "\n   <mesh>\n    <vertices>\n" +
                vertexLines.join("\n") +
                "\n    </vertices>\n    <triangles>\n" +
                triangleLines.join("\n") +
                "\n    </triangles>\n   </mesh>\n  ",
            volumes
        };
    }

    function collectPlacedParts(parsedModels, rootPath, modelSettings) {
        const root = parsedModels[pathKey(rootPath)];
        if (!root) return [];
        const placed = [];

        function partInfo(wrapper, componentObjectId, componentIndex) {
            const parts = wrapper.parts || [];
            return (
                parts.find((p) => String(p.id) === String(componentObjectId)) ||
                parts[componentIndex] ||
                { name: wrapper.name || "", extruder: wrapper.extruder || 1 }
            );
        }

        function explodeNode(node, wrapper) {
            if (!node) return;
            if (node.kind === "mesh") {
                placed.push({
                    filePath: node.filePath,
                    objectId: node.objectId,
                    transform: node.transform,
                    extruder: wrapper.extruder || 1,
                    name: wrapper.name || "",
                    body: node.obj.body
                });
                return;
            }
            const comps = node.obj.components || [];
            comps.forEach((c, index) => {
                const childPath = c.path ? normalizePath(c.path) : node.filePath;
                const info = partInfo(wrapper, c.objectid, index);
                const childTransform = formatTransform(multiplyTransform(node.transform, c.transform));
                const child = resolveTarget(parsedModels, childPath, c.objectid, childTransform, new Set());
                explodeNode(child, { name: info.name, extruder: info.extruder, parts: [] });
            });
        }

        const items = root.buildItems.length
            ? root.buildItems
            : root.objects.map((o) => ({ objectid: o.id, transform: null }));

        for (const item of items) {
            const wrapper = modelSettings[String(item.objectid)] || {};
            explodeNode(resolveTarget(parsedModels, rootPath, item.objectid, item.transform, new Set()), wrapper);
        }
        return placed;
    }

    async function loadProject(JSZip, input) {
        const zip = await JSZip.loadAsync(input);
        const filesByKey = indexZipFiles(zip);
        const rootRec =
            findZipFile(filesByKey, "3D/3dmodel.model") || findZipFile(filesByKey, "3d/3dmodel.model");
        if (!rootRec) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }
        let bambuSettings = {};
        const projectRec = findZipFile(filesByKey, "Metadata/project_settings.config");
        if (projectRec) {
            try {
                bambuSettings = extractBambuSettings(JSON.parse(await projectRec.entry.async("string")));
            } catch (e) {
                bambuSettings = {};
            }
        }
        let modelSettings = {};
        const modelSetRec = findZipFile(filesByKey, "Metadata/model_settings.config");
        if (modelSetRec) {
            try {
                modelSettings = parseModelSettings(await modelSetRec.entry.async("string"));
            } catch (e) {
                modelSettings = {};
            }
        }
        const modelXmlByPath = {};
        for (const rec of collectModelFiles(filesByKey)) {
            modelXmlByPath[normalizePath(rec.relativePath)] = await rec.entry.async("string");
        }
        return {
            zip,
            filesByKey,
            rootRec,
            bambuSettings,
            modelSettings,
            parsedModels: parseAllModels(modelXmlByPath)
        };
    }

    async function extractPreviewMeshes(JSZip, input) {
        const project = await loadProject(JSZip, input);
        const palette = asArray(project.bambuSettings.filament_colour);
        const colors = palette.length ? palette : ["#B0B0B0"];
        const placed = collectPlacedParts(project.parsedModels, project.rootRec.relativePath, project.modelSettings);
        const meshes = [];

        for (const part of placed) {
            const geom = parseMeshGeometry(part.body);
            if (!geom.triangles.length) continue;
            const positions = [];
            const vertexColors = [];
            const defaultIdx = stateToMaterialIndex(0, part.extruder, colors.length);
            for (const tri of geom.triangles) {
                let idx = defaultIdx;
                if (Number.isInteger(tri.p1)) {
                    idx = Math.min(Math.max(tri.p1, 0), colors.length - 1);
                } else if (tri.paint) {
                    idx = stateToMaterialIndex(decodePaintState(tri.paint), part.extruder, colors.length);
                }
                const rgb = hexToRgb01(colors[idx] || "#B0B0B0");
                const pts = [tri.v1, tri.v2, tri.v3].map((vi) =>
                    transformPoint(geom.vertices[vi] || [0, 0, 0], part.transform)
                );
                for (const p of pts) {
                    positions.push(p[0], p[1], p[2]);
                    vertexColors.push(rgb[0], rgb[1], rgb[2]);
                }
            }
            meshes.push({
                name: part.name,
                extruder: part.extruder,
                triangleCount: geom.triangles.length,
                positions,
                colors: vertexColors
            });
        }

        return {
            meshes,
            palette: colors,
            partCount: meshes.length,
            triangleCount: meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0)
        };
    }

    async function sanitize3mf(JSZip, input, options) {
        const opts = options || {};
        const log = opts.log || function () {};
        const zip = await JSZip.loadAsync(input);
        const filesByKey = indexZipFiles(zip);

        const rootRec =
            findZipFile(filesByKey, "3D/3dmodel.model") || findZipFile(filesByKey, "3d/3dmodel.model");
        if (!rootRec) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        let bambuSettings = {};
        const projectRec = findZipFile(filesByKey, "Metadata/project_settings.config");
        if (projectRec) {
            logLine(log, "Found Bambu/Orca print settings. Extracting designer process settings...");
            try {
                const parsed = JSON.parse(await projectRec.entry.async("string"));
                bambuSettings = extractBambuSettings(parsed);
                logLine(
                    log,
                    `Extracted walls=${bambuSettings.wall_loops || "default"}, layer=${bambuSettings.layer_height || "default"}, line width=${bambuSettings.line_width || "default"}, infill=${bambuSettings.sparse_infill_density || "default"}`
                );
            } catch (e) {
                logLine(log, "Warning: Could not parse project_settings.config JSON.");
            }
        }

        let modelSettings = {};
        let plates = [];
        const modelSetRec = findZipFile(filesByKey, "Metadata/model_settings.config");
        if (modelSetRec) {
            try {
                const modelXml = await modelSetRec.entry.async("string");
                modelSettings = parseModelSettings(modelXml);
                plates = parsePlates(modelXml);
                logLine(log, `Read per-object extruder/color assignments for ${Object.keys(modelSettings).length} object(s).`);
                if (plates.length) {
                    logLine(log, `Read ${plates.length} plate(s) from the original project.`);
                }
            } catch (e) {
                logLine(log, "Warning: Could not parse model_settings.config.");
            }
        }

        const modelXmlByPath = {};
        for (const rec of collectModelFiles(filesByKey)) {
            modelXmlByPath[normalizePath(rec.relativePath)] = await rec.entry.async("string");
        }

        const parsedModels = parseAllModels(modelXmlByPath);
        const mappedSettings = mapSettingsToSlic3r(bambuSettings);
        const flattened = buildFlattenedModel({
            parsedModels,
            rootPath: rootRec.relativePath,
            modelSettings,
            bambuSettings,
            mappedSettings,
            plates
        });
        flattened.logs.forEach((line) => logLine(log, line));

        const hadProduction = Object.keys(modelXmlByPath).some((p) => /objects\/object_/i.test(p)) ||
            /requiredextensions\s*=\s*"p"/i.test(modelXmlByPath[normalizePath(rootRec.relativePath)] || "");
        if (hadProduction) {
            logLine(log, "Flattened 3MF Production Extension into a single core 3dmodel.model (required for Cura/Prusa/Anycubic).");
        }
        logLine(log, `Preserved geometry: ${flattened.stats.vertices} vertices, ${flattened.stats.triangles} triangles, ${flattened.stats.paintColors} painted faces.`);
        logLine(log, `Preserved ${flattened.stats.materials} filament color(s) and painted faces as 3MF materials + paint_color.`);

        const newZip = new JSZip();
        newZip.file("[Content_Types].xml", contentTypesXml());

        let hasThumbnail = false;
        const plateThumb =
            findZipFile(filesByKey, "Metadata/plate_1.png") ||
            findZipFile(filesByKey, "Metadata/thumbnail.png") ||
            findZipFile(filesByKey, "Metadata/top_1.png");
        if (plateThumb) {
            newZip.file("Metadata/thumbnail.png", await plateThumb.entry.async("uint8array"));
            hasThumbnail = true;
        }
        newZip.file("_rels/.rels", relsXml(hasThumbnail));
        newZip.file("3D/3dmodel.model", flattened.xml);

        const cleanedProject = sanitizeProjectSettings(bambuSettings);
        if (Object.keys(cleanedProject).length) {
            newZip.file("Metadata/project_settings.config", JSON.stringify(cleanedProject, null, 2));
            logLine(log, `Wrote sanitized process/filament settings (${Object.keys(cleanedProject).length} keys). Printer/machine profile stripped.`);
        }
        if (Object.keys(mappedSettings).length) {
            newZip.file("Metadata/Slic3r_PE.config", buildSlic3rConfig(mappedSettings));
            logLine(log, "Wrote PrusaSlicer/Anycubic Slic3r_PE.config (walls, line width, infill, supports, colors).");
        }
        if (flattened.objectMeta.length) {
            newZip.file("Metadata/Slic3r_PE_model.config", buildSlic3rModelConfig(flattened.objectMeta));
            newZip.file(
                "Metadata/model_settings.config",
                buildModelSettingsConfig(flattened.objectMeta, flattened.plates, flattened.assembleItems)
            );
            logLine(
                log,
                `Wrote per-object filament/extruder assignments and ${flattened.plates.length} plate(s).`
            );
        }

        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            if (shouldDropEntry(relativePath)) {
                if (
                    pathKey(relativePath).includes(".gcode") ||
                    pathKey(relativePath).includes("slice_info") ||
                    pathKey(relativePath).includes("project_settings")
                ) {
                    logLine(log, "Stripping proprietary/cached data: " + relativePath);
                }
                continue;
            }
            if (pathKey(relativePath) === "metadata/thumbnail.png" && hasThumbnail) continue;
            logLine(log, "Preserving asset: " + relativePath);
            newZip.file(relativePath, await entry.async("uint8array"));
        }

        const bytes = await newZip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        });

        return {
            bytes,
            report: {
                settings: mappedSettings,
                projectKeys: Object.keys(cleanedProject).sort(),
                ...flattened.stats,
                flattened: hadProduction
            }
        };
    }

    return {
        sanitize3mf,
        extractBambuSettings,
        mapSettingsToSlic3r,
        sanitizeProjectSettings,
        sanitizeSettingValue,
        buildSlic3rConfig,
        parseModelSettings,
        parsePlates,
        shouldDropEntry,
        shouldStripSettingKey,
        mapFillPattern,
        multiplyTransform,
        formatTransform,
        parseTransform,
        displayColor,
        decodePaintState,
        encodePaintState,
        stateToMaterialIndex,
        applyTriangleMaterials,
        extractPreviewMeshes,
        BAMBU_TO_SLIC3R
    };
});
