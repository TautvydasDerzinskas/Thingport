import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { UnauthorizedError } from "../../api/client";
import { collectionsApi, type Collection } from "../../api/collections";
import { ListRowSkeletons } from "../ListSkeleton";
import NewCollectionField from "../NewCollectionField";
import { toCollection, type ToolCollection } from "./toolSdk";

type Props = {
  open: boolean;
  title?: string;
  onClose: (picked: ToolCollection | null) => void;
  onUnauthorized?: () => void;
};

/** Which of the user's collections a tool saves to, or a new one made here: a tool's Save dialog. */
export default function CollectionPickerDialog({ open, title, onClose, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCollections(null);
    setChosen(null);
    setQuery("");
    setError(null);
    collectionsApi
      .list()
      // Only ones it can save into: not the built-in ones, nor a tool's own.
      .then((all) => active && setCollections(all.filter((c) => !c.system_key && !c.tool_id)))
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof UnauthorizedError && onUnauthorized) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (collections ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [collections, query]);

  const picked = collections?.find((c) => c.id === chosen) ?? null;

  return (
    <Dialog open={open} onClose={() => onClose(null)} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>{title || t("tools.picker.title")}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pb: 1 }}>
        <TextField
          size="small"
          placeholder={t("tools.picker.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
            htmlInput: { "aria-label": t("tools.picker.search") },
          }}
        />
        <Box sx={{ height: 260, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: "10px" }}>
          {collections === null ? (
            <Box sx={{ p: 1.5 }}>
              <ListRowSkeletons count={5} leadSize={28} />
            </Box>
          ) : shown.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
              {collections.length ? t("tools.picker.noMatch") : t("tools.picker.empty")}
            </Typography>
          ) : (
            <List dense disablePadding aria-label={title || t("tools.picker.title")}>
              {shown.map((collection) => (
                <ListItemButton
                  key={collection.id}
                  aria-pressed={collection.id === chosen}
                  selected={collection.id === chosen}
                  onClick={() => setChosen(collection.id)}
                  onDoubleClick={() => onClose(toCollection(collection))}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    {collection.id === chosen ? (
                      <CheckIcon fontSize="small" color="primary" />
                    ) : (
                      <CollectionsOutlinedIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={collection.name}
                    secondary={t("tools.picker.count", { count: collection.item_count })}
                    primaryTypographyProps={{ noWrap: true }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
        <NewCollectionField
          onUnauthorized={onUnauthorized}
          onCreated={(made) => {
            setCollections((prev) => [made, ...(prev ?? [])]);
            setChosen(made.id);
          }}
        />
        {error && (
          <Typography variant="caption" color="error" role="alert">
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(null)}>{t("tools.picker.cancel")}</Button>
        <Button variant="contained" disabled={!picked} onClick={() => picked && onClose(toCollection(picked))}>
          {t("tools.picker.choose")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
