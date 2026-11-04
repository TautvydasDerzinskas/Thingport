import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import { UnauthorizedError } from "../api/client";
import { printsApi, type Print } from "../api/prints";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ListRowSkeletons } from "./ListSkeleton";

const PAGE = 30;

/** A model's picture as a small square, or a cube where it has none. */
export function ModelThumb({ url, size = 40 }: { url: string | null | undefined; size?: number }) {
  return (
    <Avatar
      variant="rounded"
      src={url ? printsApi.fileUrl(url) : undefined}
      alt=""
      sx={{ width: size, height: size, bgcolor: "action.hover", color: "text.secondary", flexShrink: 0 }}
    >
      <ViewInArOutlinedIcon sx={{ fontSize: Math.round(size * 0.55) }} />
    </Avatar>
  );
}

type Props = {
  title: string;
  /** What the confirm button says, before the count. */
  confirmLabel: string;
  /** How many can be picked; one picks straight away. */
  max: number;
  onClose: () => void;
  onPick: (models: Print[]) => void;
  onUnauthorized?: () => void;
};

/** Models from the user's own library, found as they type (newest first with nothing typed). */
export default function ModelPickerDialog({ title, confirmLabel, max, onClose, onPick, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [query, setQuery] = React.useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const [models, setModels] = React.useState<Print[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [picked, setPicked] = React.useState<Print[]>([]);
  const pickedIds = new Set(picked.map((model) => model.id));

  React.useEffect(() => {
    let current = true;
    setFailed(false);
    printsApi.list({ q: debounced || undefined, order_by: debounced ? "relevance" : "newest", limit: PAGE }).then(
      (result) => {
        if (current) setModels(result.items);
      },
      (err) => {
        if (!current) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [debounced, onUnauthorized]);

  const toggle = (model: Print) => {
    if (max === 1) {
      onPick([model]);
      return;
    }
    setPicked((list) =>
      list.some((entry) => entry.id === model.id)
        ? list.filter((entry) => entry.id !== model.id)
        : list.length < max
          ? [...list, model]
          : list,
    );
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          // The dialog is for finding one: typing its name is the first thing to do.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("modelPicker.search")}
          inputProps={{ "aria-label": t("modelPicker.search") }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ mt: 0.5, mb: 1 }}
        />
        {max > 1 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            {t("modelPicker.limit", { count: max })}
          </Typography>
        )}
        <Box sx={{ height: 360, overflowY: "auto", mx: -1 }}>
          {failed ? (
            <Alert severity="error" sx={{ mx: 1 }}>
              {t("modelPicker.loadFailed")}
            </Alert>
          ) : models === null ? (
            <Box sx={{ pt: 1 }}>
              <ListRowSkeletons count={6} lead="rounded" leadSize={40} />
            </Box>
          ) : models.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 4, textAlign: "center" }}>
              {debounced ? t("modelPicker.noMatch") : t("modelPicker.emptyLibrary")}
            </Typography>
          ) : (
            <List dense disablePadding>
              {models.map((model) => {
                const chosen = pickedIds.has(model.id);
                const full = !chosen && picked.length >= max;
                return (
                  <ListItemButton
                    key={model.id}
                    onClick={() => toggle(model)}
                    disabled={full}
                    selected={chosen}
                    role={max > 1 ? "checkbox" : undefined}
                    aria-checked={max > 1 ? chosen : undefined}
                    sx={{ borderRadius: 1, gap: 1.5 }}
                  >
                    {max > 1 && (
                      <Checkbox
                        edge="start"
                        size="small"
                        checked={chosen}
                        tabIndex={-1}
                        disableRipple
                        sx={{ p: 0.25 }}
                      />
                    )}
                    <ModelThumb url={model.thumb_url} />
                    <ListItemText
                      primary={model.title || model.name}
                      secondary={model.category_name ?? undefined}
                      primaryTypographyProps={{ variant: "body2", noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption", noWrap: true }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:cancel")}</Button>
        {max > 1 && (
          <Button variant="contained" disabled={!picked.length} onClick={() => onPick(picked)}>
            {picked.length ? `${confirmLabel} (${picked.length})` : confirmLabel}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
