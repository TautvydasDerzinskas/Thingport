import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PrintFile } from "../../api/prints";
import { useToast } from "../../components/ToastProvider";
import { copyText } from "../../utils/clipboard";

type ViewerState = { fileViewer?: boolean } | null;

/** The supporting file the viewer shows: the page's `?file=`, so Back closes it and its link opens the page on the same
 *  file. Opening is a step of the page's history; another file in the open viewer replaces it, keeping that step. */
export function useViewedFile(files: readonly PrintFile[]) {
  const { t } = useTranslation(["models"]);
  const showToast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const id = params.get("file");
  const viewing = id && files.some((file) => file.id === id) ? id : null;

  const open = (fileId: string) => {
    const next = new URLSearchParams(params);
    next.set("file", fileId);
    setParams(next, viewing ? { replace: true, state: location.state } : { state: { fileViewer: true } });
  };

  const close = () => {
    // A step this page took goes back; one it came in on (a link to the file) is dropped where it is.
    if ((location.state as ViewerState)?.fileViewer) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete("file");
    setParams(next, { replace: true });
  };

  /** The page's link to the file, never the file's own address, which carries the sign-in token. */
  const copyLink = (fileId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("file", fileId);
    copyText(url.toString()).then(
      () => showToast({ message: t("models:supporting.linkCopied") }),
      () => showToast({ message: url.toString(), severity: "info" }),
    );
  };

  return { viewing, open, close, copyLink };
}
