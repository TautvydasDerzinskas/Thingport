import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import {
  settingsApi,
  type StorageOutOfPlace,
  type StorageTemplatePreview,
  type StorageTemplateProblem,
} from "../../api/settings";
import { useConfirm } from "../../components/ConfirmProvider";
import FileMoveAnimation from "../../components/FileMoveAnimation";
import { useStorageMove } from "../../components/Layout/StorageMoveContext";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import FileTreeAnimation from "../../components/storageAnimations/FileTreeAnimation";
import SectionHeader from "../../components/SectionHeader";
import StorageTemplateBuilder from "./StorageTemplateBuilder";

type Props = {
  onUnauthorized?: () => void;
};

const DEFAULT_TEMPLATE = "{category-or-folder}/{model}/{filename}";
const PREVIEW_DELAY_MS = 250;

export default function StorageSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [template, setTemplate] = React.useState(DEFAULT_TEMPLATE);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [defaultTemplate, setDefaultTemplate] = React.useState(DEFAULT_TEMPLATE);
  // The server's check of `template`; stale while it's being edited.
  const [preview, setPreview] = React.useState<StorageTemplatePreview | null>(null);
  const [asText, setAsText] = React.useState(false);
  // Files left in an older structure, to offer moving.
  const [outOfPlace, setOutOfPlace] = React.useState<StorageOutOfPlace | null>(null);
  const confirm = useConfirm();
  const { move, running: moving, track, finishedCount } = useStorageMove();
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<{ severity: "success" | "error"; message: string } | null>(null);
  const loading = saved === null;

  React.useEffect(() => {
    let active = true;
    settingsApi.getStorage().then(
      (data) => {
        if (!active) return;
        setTemplate(data.template);
        setSaved(data.template);
        setDefaultTemplate(data.default_template);
        setPreview({ template: data.template, problems: data.problems, plate_paths: data.plate_paths });
        setOutOfPlace(data.out_of_place);
      },
      (err: unknown) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setStatus({ severity: "error", message: t("adminSettings.storage.failed") });
      },
    );
    return () => {
      active = false;
    };
  }, [onUnauthorized, t]);

  // A move just ended: what's left out of place now.
  React.useEffect(() => {
    if (!finishedCount) return;
    // "They're moving" no longer holds; the notification says how it went.
    setStatus(null);
    let active = true;
    settingsApi.getStorage().then(
      (data) => active && setOutOfPlace(data.out_of_place),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [finishedCount]);

  React.useEffect(() => {
    if (loading) return;
    let active = true;
    const timer = window.setTimeout(() => {
      settingsApi.previewStorage(template).then(
        (result) => active && setPreview({ ...result, template }),
        (err: unknown) => {
          if (active && err instanceof UnauthorizedError) onUnauthorized?.();
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [template, loading, onUnauthorized]);

  const checked = preview?.template === template;
  const problems = checked ? preview.problems : [];
  const isDirty = template.trim() !== saved;
  const canSave = !loading && !saving && !moving && checked && !problems.length && isDirty;

  /** Saves `next` and moves every file it doesn't match, after saying how many that is. */
  const saveAndMove = async (next: string) => {
    setSaving(true);
    setStatus(null);
    try {
      const impact = await settingsApi.storageImpact(next);
      if (impact.files > 0) {
        const ok = await confirm({
          title: t("adminSettings.storage.moveConfirmTitle"),
          message: t("adminSettings.storage.moveConfirmMessage", {
            count: impact.files,
            models: t("adminSettings.storage.modelCount", { count: impact.models }),
          }),
          confirmLabel: t("adminSettings.storage.moveConfirm"),
        });
        if (!ok) return;
      }
      const data = await settingsApi.updateStorage(next);
      setTemplate(data.template);
      setSaved(data.template);
      setPreview({ template: data.template, problems: data.problems, plate_paths: data.plate_paths });
      setOutOfPlace(data.out_of_place);
      track(data.move);
      setStatus({
        severity: "success",
        message: t(impact.files > 0 ? "adminSettings.storage.savedMoving" : "adminSettings.storage.savedInPlace"),
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else
        setStatus({
          severity: "error",
          message: err instanceof Error ? err.message : t("adminSettings.storage.failed"),
        });
    } finally {
      setSaving(false);
    }
  };

  const problemText = (problem: StorageTemplateProblem) => {
    if (problem.code === "duplicate_token") {
      return t("adminSettings.storage.problems.duplicate_token", {
        token: t(`adminSettings.storage.tokenNames.${problem.token}`),
      });
    }
    return t(`adminSettings.storage.problems.${problem.code}`, problem);
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.storage.heading")} subtitle={t("adminSettings.storage.subtitle")} />

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="flex-start">
          <AnimatedTile>
            <FileTreeAnimation size={76} />
          </AnimatedTile>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                {t("adminSettings.storage.templateHeading")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("adminSettings.storage.templateDesc")}
              </Typography>
            </Box>

            {!isDirty && problems.length > 0 && (
              <Alert severity="warning">{t("adminSettings.storage.savedHasProblems")}</Alert>
            )}

            {asText ? (
              <TextField
                size="small"
                label={t("adminSettings.storage.templateLabel")}
                value={template}
                onChange={(event) => {
                  setTemplate(event.target.value);
                  setStatus(null);
                }}
                placeholder={defaultTemplate}
                disabled={loading || saving}
                slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
              />
            ) : (
              <StorageTemplateBuilder
                template={template}
                onChange={(next) => {
                  setTemplate(next);
                  setStatus(null);
                }}
                disabled={loading || saving}
              />
            )}
            <Stack direction="row" spacing={2}>
              <Link component="button" type="button" variant="caption" onClick={() => setAsText((value) => !value)}>
                {t(asText ? "adminSettings.storage.editAsFolders" : "adminSettings.storage.editAsText")}
              </Link>
              {template !== defaultTemplate && (
                <Link
                  component="button"
                  type="button"
                  variant="caption"
                  disabled={loading || saving}
                  onClick={() => setTemplate(defaultTemplate)}
                >
                  {t("adminSettings.storage.useDefault")}
                </Link>
              )}
            </Stack>

            {problems.map((problem) => (
              <Alert key={problem.code} severity="error">
                {problemText(problem)}
              </Alert>
            ))}

            {moving && move && (
              <Alert severity="info" icon={<FileMoveAnimation size={28} />}>
                {move.total > 0
                  ? t("adminSettings.storage.moving", { done: move.done, total: move.total })
                  : t("storageMoveProgress.starting")}
              </Alert>
            )}
            {!moving && !isDirty && !problems.length && outOfPlace && outOfPlace.files > 0 && (
              <Alert severity="info" sx={{ "& .MuiAlert-message": { flex: 1 } }}>
                {/* Beside the text where there's room, under it on a phone. */}
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  justifyContent="space-between"
                  spacing={1}
                >
                  <span>
                    {t("adminSettings.storage.outOfPlace", {
                      count: outOfPlace.files,
                      models: t("adminSettings.storage.modelCount", { count: outOfPlace.models }),
                    })}
                  </span>
                  <Button
                    color="inherit"
                    size="small"
                    disabled={saving}
                    onClick={() => void saveAndMove(saved ?? template)}
                    sx={{ flexShrink: 0 }}
                  >
                    {t("adminSettings.storage.moveThem")}
                  </Button>
                </Stack>
              </Alert>
            )}
            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
              <Button variant="contained" disabled={!canSave} onClick={() => void saveAndMove(template)}>
                {saving ? t("adminSettings.storage.saving") : t("adminSettings.storage.save")}
              </Button>
            </Stack>
            {status && <Alert severity={status.severity}>{status.message}</Alert>}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
