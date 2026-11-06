import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import { UnauthorizedError } from "../../../api/client";
import { socialApi, type RemoteModel } from "../../../api/social";
import InstanceChip from "../../../components/InstanceChip";
import { usePageHeader } from "../../../components/Layout/PageHeaderContext";
import MarkdownDescription from "../../../components/MarkdownDescription";
import UserAvatar from "../../../components/UserAvatar";
import { formatFileSize } from "../../../utils/fileSize";
import ElsewhereGone from "./ElsewhereGone";

/** A partner's model, as it said: its pictures, description and files, whose it is and which of their collections
 *  it's in. Read-only for now: downloading, opening in a slicer and copying come next. */
export default function ElsewhereModelPage({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { modelId } = useParams<{ modelId: string }>();
  const { t } = useTranslation(["models", "common"]);
  const [model, setModel] = useState<RemoteModel | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(0);
  const latest = useRef(0);

  const read = useCallback(
    (id: string) => {
      const asked = ++latest.current;
      setModel(null);
      setGone(false);
      setFailed(false);
      setShown(0);
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
  // Two files can share a name: told apart by where they are in the list, which never changes here.
  const files = model.files.map((file, position) => ({ ...file, key: `${position}:${file.name}` }));
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
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
            <UserAvatar user={model.owner} size={40} />
            <Stack sx={{ minWidth: 0 }}>
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
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                >
                  {model.owner_handle}
                </Typography>
              )}
            </Stack>
          </Stack>
          <Box>
            <InstanceChip
              instance={model.instance}
              label={t("models:explore.elsewhere.from", { name: model.instance.name })}
            />
          </Box>
          {model.description && <MarkdownDescription markdown={model.description} remote />}

          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" component="h2" sx={{ m: 0, mb: 0.5 }}>
              {t("models:explore.elsewhere.files")}
            </Typography>
            <Stack divider={<Divider flexItem />}>
              {files.map((file) => (
                <Stack key={file.key} direction="row" spacing={1} alignItems="center" sx={{ py: 0.75 }}>
                  <InsertDriveFileOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                    {file.name}
                  </Typography>
                  {file.size !== null && (
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {formatFileSize(file.size)}
                    </Typography>
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>

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

          <Alert severity="info" variant="outlined" sx={{ py: 0.25 }}>
            {t("models:explore.elsewhere.comingNext")}
          </Alert>
        </Stack>
      </Paper>
    </Box>
  );
}
