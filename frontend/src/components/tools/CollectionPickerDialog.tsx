import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { collectionsApi, type Collection } from "../../api/collections";
import { ListRowSkeletons } from "../ListSkeleton";
import { toCollection, type ToolCollection } from "./toolSdk";

type Props = {
  open: boolean;
  title?: string;
  onClose: (picked: ToolCollection | null) => void;
};

/** Which of the user's collections a tool saves to, or a new one made here: a tool's Save dialog. */
export default function CollectionPickerDialog({ open, title, onClose }: Props) {
  const { t } = useTranslation("app");
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
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
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      active = false;
    };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (collections ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [collections, query]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const made = await collectionsApi.create({ name });
      setCollections((prev) => [made, ...(prev ?? [])]);
      setChosen(made.id);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

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
        <TextField
          size="small"
          placeholder={t("tools.picker.newName")}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void create();
            }
          }}
          slotProps={{
            htmlInput: { maxLength: 200, "aria-label": t("tools.picker.newName") },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title={t("tools.picker.create")}>
                    <span>
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label={t("tools.picker.create")}
                        disabled={!newName.trim() || creating}
                        onClick={() => void create()}
                      >
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </InputAdornment>
              ),
            },
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
