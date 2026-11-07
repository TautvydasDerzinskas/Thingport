import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import LibraryAddCheckOutlinedIcon from "@mui/icons-material/LibraryAddCheckOutlined";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";
import { UnauthorizedError } from "../../../api/client";
import { FederationError } from "../../../api/federation";
import { socialApi, type RemoteCopyStatus, type RemoteModel } from "../../../api/social";
import { useToast } from "../../../components/ToastProvider";
import { formatFileSize } from "../../../utils/fileSize";

const POLL_MS = 1000;
// A status that didn't come is asked again, a little later.
const RETRY_MS = 3000;

const appear = keyframes`
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
`;

const monoSx = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 } as const;

type Props = {
  model: RemoteModel;
  onCopied: (copyId: string) => void;
  onUnauthorized?: () => void;
};

/** Copying a partner's model into the viewer's library, right on its page: each file as it comes, then a button to
 *  open the copy. It runs on the server, so leaving the page doesn't stop it, and coming back finds it still going. */
export default function RemoteCopyPanel({ model, onCopied, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const showToast = useToast();
  const [status, setStatus] = useState<RemoteCopyStatus | null>(null);
  const [starting, setStarting] = useState(false);
  // Only a copy watched from here says so when it's done; one found done already just shows its button.
  const watched = useRef(false);
  const { id, title } = model;
  const copyId = model.library_copy_id ?? (status?.state === "done" ? status.copy_id : null);

  const failMessage = (err: unknown) => {
    const key = err instanceof FederationError && err.code ? `models:explore.elsewhere.errors.${err.code}` : null;
    return key && i18n.exists(key) ? t(key) : t("models:explore.elsewhere.copyFailed");
  };

  const heard = useCallback(
    (next: RemoteCopyStatus) => {
      setStatus(next);
      if (next.state === "done" && next.copy_id) {
        onCopied(next.copy_id);
        if (watched.current) {
          watched.current = false;
          const copy = next.copy_id;
          showToast({
            message: t("models:shared.copied", { name: title }),
            severity: "success",
            action: { label: t("models:shared.openCopy"), onClick: () => navigate(`/models/${copy}`) },
            autoHideMs: 8000,
          });
        }
      }
    },
    [navigate, onCopied, showToast, t, title],
  );

  // One under way already, from an earlier visit: picked up where it is.
  useEffect(() => {
    if (model.library_copy_id) return;
    let live = true;
    socialApi.elsewhere.copyStatus(id).then(
      (value) => {
        if (!live) return;
        if (value.state === "copying") watched.current = true;
        heard(value);
      },
      (err) => {
        if (live && err instanceof UnauthorizedError) onUnauthorized?.();
      },
    );
    return () => {
      live = false;
    };
    // Asked once per model: a copy made since comes in through `heard`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const copying = status?.state === "copying";
  useEffect(() => {
    if (!copying) return;
    let live = true;
    let timer: number | undefined;
    const ask = (after: number) => {
      timer = window.setTimeout(() => {
        socialApi.elsewhere.copyStatus(id).then(
          (value) => {
            if (!live) return;
            heard(value);
            if (value.state === "copying") ask(POLL_MS);
          },
          (err) => {
            if (!live) return;
            if (err instanceof UnauthorizedError) onUnauthorized?.();
            else ask(RETRY_MS);
          },
        );
      }, after);
    };
    ask(POLL_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [copying, id, heard, onUnauthorized]);

  const start = async () => {
    setStarting(true);
    try {
      const next = await socialApi.elsewhere.copy(id);
      if (next.state === "done" && next.copy_id) {
        showToast({
          message: t("models:shared.alreadyInLibrary", { name: title }),
          severity: "info",
          action: { label: t("models:shared.openCopy"), onClick: () => navigate(`/models/${next.copy_id}`) },
          autoHideMs: 8000,
        });
      } else {
        watched.current = true;
      }
      heard(next);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: failMessage(err), severity: "error" });
    } finally {
      setStarting(false);
    }
  };

  if (copyId) {
    return (
      <Button
        variant="outlined"
        fullWidth
        startIcon={<LibraryAddCheckOutlinedIcon />}
        onClick={() => navigate(`/models/${copyId}`)}
      >
        {t("models:shared.openCopy")}
      </Button>
    );
  }

  if (!status || status.state === "idle") {
    return (
      <Button
        variant="outlined"
        fullWidth
        disabled={starting || !status}
        startIcon={starting ? <CircularProgress size={16} color="inherit" /> : <LibraryAddOutlinedIcon />}
        onClick={() => void start()}
      >
        {t("models:shared.copy")}
      </Button>
    );
  }

  const failed = status.state === "failed";
  const known = status.files.every((file) => file.size !== null);
  const total = known ? status.files.reduce((sum, file) => sum + (file.size ?? 0), 0) : 0;
  const received = status.files.reduce(
    (sum, file) => sum + (file.done ? (file.size ?? file.received) : file.received),
    0,
  );
  const done = status.files.filter((file) => file.done).length;
  // By bytes when every size is known, by files otherwise.
  const progress = Math.min(
    100,
    total > 0 ? (received / total) * 100 : (done / Math.max(1, status.files.length)) * 100,
  );
  const current = status.files.findIndex((file) => !file.done);
  // The list never changes order while it's copying, and two files may share a name.
  const rows = status.files.map((file, index) => ({
    ...file,
    key: `${index}:${file.name}`,
    active: index === current,
  }));

  return (
    <Stack
      component="output"
      spacing={1.25}
      aria-live="polite"
      sx={{
        border: 1,
        borderColor: failed ? "error.main" : "divider",
        borderRadius: "10px",
        p: 1.5,
        animation: `${appear} 200ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        {failed ? (
          <ErrorOutlineIcon fontSize="small" color="error" />
        ) : (
          <CircularProgress size={16} thickness={5} aria-hidden />
        )}
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }}>
          {failed ? t("models:explore.elsewhere.copyFailed") : t("models:explore.elsewhere.copying")}
        </Typography>
      </Stack>
      {failed ? (
        <>
          {status.error && (
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              {status.error}
            </Typography>
          )}
          <Button
            size="small"
            variant="outlined"
            disabled={starting}
            onClick={() => void start()}
            sx={{ alignSelf: "flex-start" }}
          >
            {t("common:retry")}
          </Button>
        </>
      ) : (
        <>
          <LinearProgress
            variant="determinate"
            value={progress}
            aria-label={t("models:explore.elsewhere.copying")}
            sx={{ height: 6, borderRadius: 3 }}
          />
          <Stack spacing={0.75} sx={{ maxHeight: 220, overflowY: "auto" }}>
            {rows.map(({ active, ...file }) => {
              return (
                <Stack
                  key={file.key}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ color: file.done ? "primary.main" : active ? "text.primary" : "text.secondary" }}
                >
                  <Box sx={{ width: 16, display: "flex", justifyContent: "center", flexShrink: 0 }}>
                    {file.done ? (
                      <CheckIcon sx={{ fontSize: 16 }} />
                    ) : active ? (
                      <CircularProgress size={14} thickness={5} color="inherit" aria-hidden />
                    ) : null}
                  </Box>
                  <Typography variant="body2" noWrap title={file.name} sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    {file.name}
                  </Typography>
                  <Typography component="span" color="text.secondary" sx={{ ...monoSx, flexShrink: 0 }}>
                    {active && file.received > 0
                      ? file.size !== null
                        ? t("models:explore.elsewhere.ofSize", {
                            received: formatFileSize(file.received),
                            size: formatFileSize(file.size),
                          })
                        : formatFileSize(file.received)
                      : file.size !== null
                        ? formatFileSize(file.size)
                        : ""}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {t("models:explore.elsewhere.carriesOn")}
          </Typography>
        </>
      )}
    </Stack>
  );
}
