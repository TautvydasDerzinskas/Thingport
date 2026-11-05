import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import { useTranslation } from "react-i18next";
import type { ImportCollectionEntry } from "../../../api/imports";
import type { ProviderId } from "../../../providers/index.generated";
import HelpTip from "../../HelpTip";

type Props = {
  provider?: ProviderId;
  entries: ImportCollectionEntry[];
  selected: Set<string>;
  busy: boolean;
  noEntriesLabel: string;
  onToggleEntry: (designId: string) => void;
};

function BlockedReason({ title, hint }: { title: string; hint: string }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
      <Chip label={title} size="small" variant="outlined" />
      {hint && <HelpTip text={hint} />}
    </Stack>
  );
}

/** Already-imported entries are dimmed and disabled, since importing them would do nothing, and so are the ones the
 *  provider keeps from the user, with its reason. */
export default function CollectionEntryList({
  provider,
  entries,
  selected,
  busy,
  noEntriesLabel,
  onToggleEntry,
}: Props) {
  const { t } = useTranslation("app");
  // The provider's words for its reason; a reason it has none for still says the model can't be imported.
  const blockedText = (reason: string) => ({
    title: t(`providers:${provider}.blocked.${reason}.title`, { defaultValue: t("collectionImport.blocked") }),
    hint: t(`providers:${provider}.blocked.${reason}.hint`, { defaultValue: "" }),
  });
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, maxHeight: 420, overflow: "auto" }}>
      {entries.map((entry) => (
        <FormControlLabel
          key={entry.design_id}
          sx={{
            display: "flex",
            alignItems: "center",
            m: 0,
            px: 1.5,
            py: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
            "&:last-of-type": { borderBottom: "none" },
            opacity: entry.already_imported || entry.blocked ? 0.5 : 1,
          }}
          control={
            <Checkbox
              checked={selected.has(entry.design_id)}
              onChange={() => onToggleEntry(entry.design_id)}
              disabled={busy || entry.already_imported || Boolean(entry.blocked)}
              size="small"
            />
          }
          label={
            <Stack direction="row" sx={{ width: "100%", minWidth: 0 }} alignItems="center" spacing={1.5}>
              <Box
                component="img"
                src={entry.cover ?? undefined}
                alt=""
                loading="lazy"
                decoding="async"
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 0.5,
                  objectFit: "cover",
                  flexShrink: 0,
                  bgcolor: "action.hover",
                  visibility: entry.cover ? "visible" : "hidden",
                }}
              />
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {entry.title}
              </Typography>
              {entry.already_imported && (
                <Chip
                  label={t("collectionImport.alreadyImported")}
                  size="small"
                  variant="outlined"
                  sx={{ flexShrink: 0 }}
                />
              )}
              {entry.blocked && !entry.already_imported && <BlockedReason {...blockedText(entry.blocked)} />}
            </Stack>
          }
        />
      ))}
      {entries.length === 0 && (
        <Box sx={{ px: 1.5, py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {noEntriesLabel}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
