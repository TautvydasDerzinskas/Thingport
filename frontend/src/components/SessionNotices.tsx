import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { useTranslation } from "react-i18next";
import { dismissNotice, useSessionNotices } from "../utils/sessionNotices";

/** The messages kept across a sign-in (utils/sessionNotices), one at a time, each until it's closed: at the top, clear
 *  of the toasts and of the session's own at the bottom. Only `account`'s: the signed-in user, or the one whose session
 *  ended. */
export default function SessionNotices({ account }: { account: string | null }) {
  const { t } = useTranslation("common");
  const [first] = useSessionNotices(account);
  return (
    <Snackbar open={Boolean(first)} anchorOrigin={{ vertical: "top", horizontal: "center" }}>
      <Alert onClose={dismissNotice} closeText={t("close")} severity="error" variant="filled" sx={{ width: "100%" }}>
        {first}
      </Alert>
    </Snackbar>
  );
}
