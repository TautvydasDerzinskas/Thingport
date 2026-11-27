import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import SplashLoader from "../../components/SplashLoader";
import { openModelAsDesign, type StudioArrival, type StudioModelRequest } from "./openModel";

export function StudioProgress({ message }: { message: string }) {
  return (
    <Stack
      component="output"
      spacing={2}
      alignItems="center"
      justifyContent="center"
      sx={{ minHeight: "60vh", px: 2, textAlign: "center" }}
    >
      <CircularProgress size={28} aria-hidden />
      <Typography component="span" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
        {message}
      </Typography>
    </Stack>
  );
}

/** Studio's own full-page wait, while its code or an imported model loads. */
export function StudioSplash({ label, detail }: { label: string; detail?: string }) {
  const { t } = useTranslation("app");
  return (
    <SplashLoader title={t("studio.loading.title")} label={label} phrasesKey="studio.loading.phrases" detail={detail} />
  );
}

export default function StudioModelImport({
  request,
  onUnauthorized,
}: {
  request: StudioModelRequest;
  onUnauthorized: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const { model } = request;
  const fileId = "fileId" in request ? request.fileId : undefined;
  const filename = "filename" in request ? request.filename : model.title;
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof openModelAsDesign> | null>(null);
  useEffect(() => {
    // Reuse the request if StrictMode repeats the effect while the import is running.
    if (pending.current === null) pending.current = openModelAsDesign(model, fileId, t("studio.design.untitled"));
    let active = true;
    void pending.current.then(
      (design) => {
        if (!active) return;
        navigate(`/studio?design=${encodeURIComponent(design.id)}`, {
          replace: true,
          state: { imported: design.mesh ?? undefined } satisfies StudioArrival,
        });
      },
      (reason: unknown) => {
        if (!active) return;
        if (reason instanceof UnauthorizedError) onUnauthorized();
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [fileId, model, navigate, onUnauthorized, t]);

  if (error === null) {
    return <StudioSplash label={t("studio.importModel.preparing", { filename })} detail={filename} />;
  }
  return (
    <Stack spacing={2} alignItems="center" justifyContent="center" sx={{ minHeight: "60vh", px: 2 }}>
      <Alert severity="error" sx={{ maxWidth: "100%", overflowWrap: "anywhere" }}>
        <AlertTitle>{t("studio.importModel.failed", { filename })}</AlertTitle>
        {error}
      </Alert>
      <Button onClick={() => navigate(-1)}>{t("common:back")}</Button>
    </Stack>
  );
}
