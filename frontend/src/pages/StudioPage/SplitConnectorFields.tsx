import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import type { SplitConnectorChanges } from "../../studio/commands";
import { LIMITS, type SplitConnector } from "../../studio/document";
import { NumberField } from "./fields";

export const DEFAULT_CONNECTOR: SplitConnector = {
  diameter: 5,
  depth: 3,
  clearance: 0.2,
  offset: [0, 0],
  count: 1,
  spacing: 10,
};

export default function SplitConnectorFields({
  connector,
  live,
  onChange,
}: {
  connector: SplitConnector;
  live?: boolean;
  onChange: (changes: SplitConnectorChanges) => void;
}) {
  const { t } = useTranslation("app");
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
      <NumberField
        label={t("studio.print.pinDiameter")}
        value={connector.diameter}
        unit="mm"
        live={live}
        validate={(diameter) => diameter > 0 && diameter <= LIMITS.size}
        onCommit={(diameter) => onChange({ diameter })}
      />
      <NumberField
        label={t("studio.print.pinDepth")}
        value={connector.depth}
        unit="mm"
        live={live}
        validate={(depth) => depth > 0 && depth <= LIMITS.size}
        onCommit={(depth) => onChange({ depth })}
      />
      <NumberField
        label={t("studio.print.clearance")}
        value={connector.clearance}
        unit="mm"
        live={live}
        validate={(clearance) => clearance >= 0 && clearance <= 5}
        onCommit={(clearance) => onChange({ clearance })}
      />
      <NumberField
        label={t("studio.print.pinCount")}
        value={connector.count}
        live={live}
        validate={(count) => Number.isInteger(count) && count >= 1 && count <= 8}
        onCommit={(count) => onChange({ count })}
      />
      <NumberField
        label={t("studio.print.offsetU")}
        value={connector.offset[0]}
        unit="mm"
        live={live}
        onCommit={(u) => onChange({ offset: { u } })}
      />
      <NumberField
        label={t("studio.print.offsetV")}
        value={connector.offset[1]}
        unit="mm"
        live={live}
        onCommit={(v) => onChange({ offset: { v } })}
      />
      <NumberField
        label={t("studio.print.spacing")}
        value={connector.spacing}
        unit="mm"
        live={live}
        validate={(spacing) => spacing > 0 && spacing <= LIMITS.size}
        onCommit={(spacing) => onChange({ spacing })}
      />
    </Box>
  );
}
