import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import HelpTip from "../../components/HelpTip";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import Segmented from "../../components/controls/Segmented";
import { studioApi, type StudioDesignSummary, type StudioLibraryModel } from "../../api/studio";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { relativeTime } from "../../utils/relativeTime";
import { BoxIcon } from "./studioIcons";

type Tab = "designs" | "library";

type Props = {
  open: boolean;
  /** The design that's open, which Insert brings a model into; null for none. */
  currentId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Brings a library model's file in, as a new design or into the open one; false if it didn't. */
  onImport: (model: { id: string; title: string }, fileId: string, into: "new" | "current") => Promise<boolean>;
  onError: (error: unknown) => void;
};

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Opens a design, or a library model's 3D file as a new one, or into the open one. */
export default function DesignsDialog({ open, currentId, onClose, onOpen, onNew, onImport, onError }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [tab, setTab] = useState<Tab>("designs");

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>{t("studio.design.openTitle")}</DialogTitle>
      <Box sx={{ px: 3, pb: 1.5 }}>
        <Segmented
          label={t("studio.design.openTitle")}
          value={tab}
          options={[
            { value: "designs", label: t("studio.open.designs") },
            { value: "library", label: t("studio.open.library") },
          ]}
          onChange={setTab}
        />
      </Box>
      <DialogContent sx={{ px: 1.5, pt: 0, minHeight: 320 }}>
        {tab === "designs" ? (
          <Designs open={open} currentId={currentId} onOpen={onOpen} onError={onError} />
        ) : (
          <Library open={open} canInsert={currentId !== null} onImport={onImport} onError={onError} />
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<AddBoxOutlinedIcon />} onClick={onNew}>
          {t("studio.design.new")}
        </Button>
        <Button onClick={onClose}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

function Designs({ open, currentId, onOpen, onError }: Pick<Props, "open" | "currentId" | "onOpen" | "onError">) {
  const { t, i18n } = useTranslation("app");
  const [designs, setDesigns] = useState<StudioDesignSummary[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setDesigns(null);
    studioApi.list().then(setDesigns, (error: unknown) => {
      setDesigns([]);
      onError(error);
    });
  }, [open, onError]);

  if (designs === null) return <ListRowSkeletons count={4} leadSize={28} twoLines />;
  if (designs.length === 0)
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
        {t("studio.design.empty")}
      </Typography>
    );
  return (
    <List dense disablePadding>
      {designs.map((design) => (
        <ListItemButton
          key={design.id}
          selected={design.id === currentId}
          onClick={() => onOpen(design.id)}
          sx={{ borderRadius: 1.5 }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "text.secondary" }}>
            <BoxIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={design.name}
            secondary={`${t("studio.design.features", { count: design.feature_count })} · ${relativeTime(
              design.updated_at,
              i18n.language,
            )}`}
            primaryTypographyProps={{ noWrap: true }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

function Library({
  open,
  canInsert,
  onImport,
  onError,
}: Pick<Props, "open" | "onImport" | "onError"> & { canInsert: boolean }) {
  const { t } = useTranslation("app");
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const [models, setModels] = useState<StudioLibraryModel[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModels(null);
    studioApi.library(search).then(
      (page) => {
        if (cancelled) return;
        setModels(page.models);
        setNext(page.next_offset);
      },
      (error: unknown) => {
        if (cancelled) return;
        setModels([]);
        onError(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, search, onError]);

  const more = () => {
    if (next === null) return;
    studioApi.library(search, next).then((page) => {
      setModels((prev) => [...(prev ?? []), ...page.models]);
      setNext(page.next_offset);
    }, onError);
  };

  const bring = async (model: StudioLibraryModel, fileId: string, into: "new" | "current") => {
    setBusy(`${fileId}:${into}`);
    await onImport(model, fileId, into);
    setBusy(null);
  };

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, mb: 1.5 }}>
        <TextField
          size="small"
          fullWidth
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("studio.open.search")}
          slotProps={{
            htmlInput: { "aria-label": t("studio.open.search") },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <HelpTip text={t("studio.open.help")} />
      </Stack>
      {models === null ? (
        <ListRowSkeletons count={4} leadSize={40} twoLines />
      ) : models.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          {search ? t("studio.open.noMatches") : t("studio.open.emptyLibrary")}
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {models.map((model) => (
            <Box key={model.id} sx={{ px: 1, py: 0.75, borderRadius: 1.5, "&:hover": { bgcolor: "action.hover" } }}>
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Avatar variant="rounded" src={model.thumb_url ?? undefined} alt="" sx={{ width: 40, height: 40 }}>
                  <BoxIcon fontSize="small" />
                </Avatar>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
                  {model.title}
                </Typography>
              </Stack>
              {model.files.map((file) => (
                <Stack key={file.id} direction="row" alignItems="center" spacing={0.5} sx={{ pl: 6.5, mt: 0.25 }}>
                  <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={file.name}>
                    {file.name}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {" "}
                      · {sizeLabel(file.size)}
                    </Typography>
                  </Typography>
                  <Tooltip title={t("studio.open.openHelp")}>
                    <span>
                      <Button
                        size="small"
                        disabled={busy !== null}
                        onClick={() => void bring(model, file.id, "new")}
                        startIcon={busy === `${file.id}:new` ? <CircularProgress size={12} /> : undefined}
                      >
                        {t("studio.open.open")}
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("studio.open.insertHelp")}>
                    <span>
                      <Button
                        size="small"
                        disabled={busy !== null || !canInsert}
                        onClick={() => void bring(model, file.id, "current")}
                        startIcon={busy === `${file.id}:current` ? <CircularProgress size={12} /> : undefined}
                      >
                        {t("studio.open.insert")}
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              ))}
            </Box>
          ))}
          {next !== null && (
            <Button size="small" onClick={more} sx={{ alignSelf: "center" }}>
              {t("studio.open.loadMore")}
            </Button>
          )}
        </Stack>
      )}
    </>
  );
}
