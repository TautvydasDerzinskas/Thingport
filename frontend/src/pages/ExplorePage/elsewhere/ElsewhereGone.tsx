import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";

/** Something of a partner's that isn't here any more: no longer shared, or the instance no longer connected. */
export default function ElsewhereGone() {
  const { t } = useTranslation("models");
  const navigate = useNavigate();
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 8, color: "text.secondary", textAlign: "center" }}>
      <HubOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
      <Typography variant="body2">{t("explore.elsewhere.gone")}</Typography>
      <Button size="small" onClick={() => navigate("/explore")}>
        {t("explore.backToExplore")}
      </Button>
    </Stack>
  );
}
