import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { MigrateCounts, MigrateOptions } from "../../api/migrate";
import HelpTip from "../../components/HelpTip";
import { k } from "./parts";

export type Choices = Omit<MigrateOptions, "people">;

/** What comes unless switched off: everything of the people's own. Instance settings and secrets stay unless asked
 *  for, as they replace this instance's. */
export const DEFAULT_CHOICES: Choices = {
  collections: true,
  syncs: true,
  signIns: true,
  studio: true,
  widgets: true,
  tools: true,
  settings: false,
  secrets: false,
};

const ROWS: { key: keyof Choices; count: keyof MigrateCounts }[] = [
  { key: "collections", count: "collections" },
  { key: "syncs", count: "syncs" },
  { key: "signIns", count: "signIns" },
  { key: "studio", count: "designs" },
  { key: "widgets", count: "widgets" },
  { key: "tools", count: "tools" },
  { key: "settings", count: "settings" },
  { key: "secrets", count: "secrets" },
];

type Props = {
  choices: Choices;
  counts: MigrateCounts | undefined;
  onChange: (choices: Choices) => void;
  disabled?: boolean;
};

export default function ComesStep({ choices, counts, onChange, disabled }: Props) {
  const { t } = useTranslation("app");
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {t(k("comes.always"))}
      </Typography>
      <Stack divider={<Divider flexItem />}>
        {ROWS.map(({ key, count }) => {
          // A sync keeps a collection in step, so it needs the collection.
          const off = key === "syncs" && !choices.collections;
          const label = t(k(`comes.${key}`));
          return (
            <Stack key={key} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" component="span" sx={{ opacity: off ? 0.5 : 1 }}>
                  {label}
                </Typography>
                <HelpTip text={t(k(`comes.${key}Help`))} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 32, textAlign: "right" }}>
                {(counts?.[count] ?? 0).toLocaleString()}
              </Typography>
              <Switch
                checked={choices[key] && !off}
                disabled={disabled || off}
                onChange={(event) => onChange({ ...choices, [key]: event.target.checked })}
                slotProps={{ input: { "aria-label": label } }}
              />
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}
