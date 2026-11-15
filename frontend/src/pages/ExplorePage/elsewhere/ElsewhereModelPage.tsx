import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import { UnauthorizedError } from "../../../api/client";
import { FederationError } from "../../../api/federation";
import { printsApi } from "../../../api/prints";
import { socialApi, type RemoteModel } from "../../../api/social";
import InstanceChip from "../../../components/InstanceChip";
import { usePageHeader } from "../../../components/Layout/PageHeaderContext";
import MarkdownDescription from "../../../components/MarkdownDescription";
import LicenseStrip from "../../../components/license/LicenseStrip";
import { useToast } from "../../../components/ToastProvider";
import UserAvatar from "../../../components/UserAvatar";
import { switchSlicer } from "../../../hooks/useSlicerPreference";
import { saveResponseToDisk } from "../../../utils/downloadResponse";
import { extOf } from "../../../utils/fileExtensions";
import ModelFileSelect from "../../ModelDetailPage/ModelFileSelect";
import OpenInSlicerButton from "../../ModelDetailPage/OpenInSlicerButton";
import { useSlicerChoice, type ModelFile } from "../../ModelDetailPage/useOpenInSlicer";
import ElsewhereGone from "./ElsewhereGone";
import RemoteCopyPanel from "./RemoteCopyPanel";

// What slicers open; anything else is downloaded instead.
const SLICES = new Set(["stl", "3mf", "step", "stp", "obj"]);

const monoSx = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as const;

/** A partner's model, as it said: its pictures, description and files, whose it is and which of their collections
 *  it's in. Laid out like another user's model here: copied to the viewer's library, opened in a slicer or
 *  downloaded, every file coming through this instance. */
export default function ElsewhereModelPage({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { modelId } = useParams<{ modelId: string }>();
  const { t, i18n } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [model, setModel] = useState<RemoteModel | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(0);
  // The file the open and download actions apply to.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const latest = useRef(0);

  const read = useCallback(
    (id: string) => {
      const asked = ++latest.current;
      setModel(null);
      setGone(false);
      setFailed(false);
      setShown(0);
      setSelectedKey(null);
      socialApi.elsewhere.model(id).then(
        (value) => {
          if (asked !== latest.current) return;
          if (value) setModel(value);
          else setGone(true);
        },
        (err) => {
          if (asked !== latest.current) return;
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setFailed(true);
        },
      );
    },
    [onUnauthorized],
  );

  useEffect(() => {
    if (modelId) read(modelId);
    return () => {
      latest.current += 1;
    };
  }, [modelId, read]);

  usePageHeader({ title: model?.title });

  const { slicerOption, slicerOptions } = useSlicerChoice();
  const [downloading, setDownloading] = useState(false);
  // Those it can be had of, through this instance. Two can share a name: told apart by where they are in the list,
  // which never changes here.
  const files = useMemo<ModelFile[]>(
    () =>
      (model?.files ?? []).flatMap((file, position) =>
        file.url
          ? [
              {
                key: `${position}:${file.name}`,
                url: file.url,
                filename: file.name,
                launchFilename: file.name,
                index: position,
                plate: null,
                size: file.size,
                folder: file.folder ?? null,
              },
            ]
          : [],
      ),
    [model],
  );
  // The first a slicer opens, until one is picked.
  const selected =
    files.find((file) => file.key === selectedKey) ??
    files.find((file) => SLICES.has(extOf(file.filename))) ??
    files[0] ??
    null;

  const copied = useCallback(
    (copiedId: string, copyId: string) =>
      setModel((current) => (current?.id === copiedId ? { ...current, library_copy_id: copyId } : current)),
    [],
  );

  const failedDownload = (err: unknown) => {
    if (err instanceof UnauthorizedError) return onUnauthorized?.();
    // The server's reason where there's a word for it: a ZIP too big, or another being made.
    const key = err instanceof FederationError && err.code ? `models:explore.elsewhere.errors.${err.code}` : null;
    showToast({
      message: key && i18n.exists(key) ? t(key) : t("models:detail.downloadFailed"),
      severity: "error",
    });
  };
  const download = async (file: ModelFile) => {
    setDownloading(true);
    try {
      const res = await fetch(printsApi.fileUrl(file.url));
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error("Download failed");
      await saveResponseToDisk(res, file.filename);
    } catch (err) {
      failedDownload(err);
    } finally {
      setDownloading(false);
    }
  };
  const downloadZip = async () => {
    if (!model) return;
    setDownloading(true);
    try {
      await saveResponseToDisk(await socialApi.elsewhere.zip(model.id), `${model.title || "model"}.zip`);
    } catch (err) {
      failedDownload(err);
    } finally {
      setDownloading(false);
    }
  };

  if (gone) return <ElsewhereGone />;
  if (failed) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:explore.loadFailed")}</Typography>
        <Button size="small" onClick={() => modelId && read(modelId)}>
          {t("common:retry")}
        </Button>
      </Stack>
    );
  }

  const layoutSx = {
    display: "grid",
    gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 360px" },
    gap: 2,
    maxWidth: "1600px",
    mx: "auto",
  };
  if (!model) {
    return (
      <Box sx={layoutSx} aria-busy>
        <Skeleton variant="rounded" sx={{ aspectRatio: "4 / 3", height: "auto", borderRadius: "12px" }} />
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: "12px" }} />
      </Box>
    );
  }

  const picture = model.images[shown] ?? null;
  return (
    <Box sx={layoutSx}>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: "12px", minWidth: 0 }}>
        <Box
          sx={{
            aspectRatio: "4 / 3",
            borderRadius: "10px",
            overflow: "hidden",
            bgcolor: (muiTheme) =>
              muiTheme.palette.mode === "dark" ? muiTheme.thingport.pageBackground : muiTheme.palette.grey[100],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {picture ? (
            <Box
              component="img"
              src={picture}
              alt={model.title}
              sx={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            <ViewInArOutlinedIcon
              sx={{ fontSize: 96, color: "text.disabled" }}
              aria-label={t("models:explore.elsewhere.noPictures")}
            />
          )}
        </Box>
        {model.images.length > 1 && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, overflowX: "auto", pb: 0.5 }}>
            {model.images.map((url, index) => (
              <ButtonBase
                key={url}
                onClick={() => setShown(index)}
                aria-label={t("models:explore.elsewhere.picture", { number: index + 1 })}
                aria-pressed={index === shown}
                sx={{
                  flexShrink: 0,
                  width: 72,
                  height: 54,
                  borderRadius: "8px",
                  overflow: "hidden",
                  outline: "2px solid",
                  outlineColor: index === shown ? "primary.main" : "transparent",
                  outlineOffset: -2,
                  transition: "outline-color .15s ease",
                  "&.Mui-focusVisible": { outlineColor: "primary.main" },
                }}
              >
                <Box
                  component="img"
                  src={url}
                  alt=""
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </ButtonBase>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: "12px", minWidth: 0 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("models:shared.sharedByLabel")}
            </Typography>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
              <UserAvatar user={model.owner} size={32} />
              <Stack sx={{ minWidth: 0, flex: 1 }}>
                <Link
                  component={RouterLink}
                  to={`/explore/elsewhere/people/${model.owner.id}`}
                  underline="hover"
                  fontWeight={600}
                  noWrap
                >
                  {model.owner.display_name}
                </Link>
                {model.owner_handle && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={monoSx}>
                    {model.owner_handle}
                  </Typography>
                )}
              </Stack>
              <Box sx={{ flexShrink: 0, maxWidth: "45%" }}>
                <InstanceChip instance={model.instance} label={model.instance.name} />
              </Box>
            </Stack>
          </Box>

          {/* A copy made already stays reachable, even with the files no longer offered. */}
          {(files.length > 0 || model.library_copy_id) && (
            <RemoteCopyPanel key={model.id} model={model} onCopied={copied} onUnauthorized={onUnauthorized} />
          )}
          {files.length > 0 ? (
            <>
              {selected && files.length > 1 && (
                <ModelFileSelect files={files} selected={selected} onSelect={(file) => setSelectedKey(file.key)} />
              )}
              {selected && (
                <OpenInSlicerButton
                  file={selected}
                  canOpen={SLICES.has(extOf(selected.filename))}
                  slicerOption={slicerOption}
                  slicerOptions={slicerOptions}
                  onOpened={(slicerId) => void switchSlicer(slicerId)}
                  downloading={downloading}
                  onDownload={() => void download(selected)}
                  zipCount={files.length}
                  onDownloadZip={() => void downloadZip()}
                />
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("models:explore.elsewhere.filesUnavailable")}
            </Typography>
          )}

          {model.description && <MarkdownDescription markdown={model.description} remote />}

          {model.license !== undefined && (
            <LicenseStrip
              variant="standalone"
              license={model.license}
              loading={false}
              provider={model.source_provider}
              credit={{ title: model.title, creator: model.creator, sourceUrl: model.source_url }}
            />
          )}

          {model.collections.length > 0 && (
            <Box>
              <Typography
                variant="caption"
                fontWeight={700}
                color="text.secondary"
                component="h2"
                sx={{ m: 0, mb: 0.75 }}
              >
                {t("models:explore.elsewhere.inCollections")}
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {model.collections.map((collection) => (
                  <Chip
                    key={collection.id}
                    size="small"
                    clickable
                    component={RouterLink}
                    to={`/explore/elsewhere/collections/${collection.id}`}
                    label={collection.name}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
