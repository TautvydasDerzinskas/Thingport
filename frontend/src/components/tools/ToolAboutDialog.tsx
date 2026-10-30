import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import type { Tool } from "../../api/tools";
import HelpTip from "../HelpTip";
import ToolIcon from "./ToolIcon";

type Props = {
  tool: Tool | null;
  onClose: () => void;
  onOpen?: (tool: Tool) => void;
};

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="baseline">
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 96, flexShrink: 0, display: "flex", alignItems: "center" }}
      >
        {label}
        {help && <HelpTip text={help} />}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
    </Stack>
  );
}

/** What a tool is: who made it, its version, where it came from, what it reaches and the models it brings. */
export default function ToolAboutDialog({ tool, onClose, onOpen }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const manifest = tool?.manifest;

  return (
    <Dialog open={Boolean(tool)} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="tool-about-title">
      {tool && manifest && (
        <>
          <DialogContent sx={{ pt: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  flexShrink: 0,
                  borderRadius: "14px",
                  border: 1,
                  borderColor: "divider",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "primary.main",
                }}
              >
                <ToolIcon iconUrl={manifest.iconUrl} size={32} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  id="tool-about-title"
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{ color: (theme) => theme.thingport.headingText }}
                >
                  {manifest.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("tools.about.version", { version: manifest.version })}
                </Typography>
              </Box>
            </Stack>
            {manifest.description && (
              <Typography variant="body2" sx={{ mb: 2, whiteSpace: "pre-line" }}>
                {manifest.description}
              </Typography>
            )}
            <Stack spacing={1}>
              <Row label={t("tools.about.source")}>
                <Typography variant="body2">
                  {tool.source === "repo" ? t("tools.about.fromRepo") : t("tools.about.own")}
                </Typography>
              </Row>
              {manifest.author && (
                <Row label={t("tools.about.author")}>
                  {manifest.authorUrl ? (
                    <Link href={manifest.authorUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                      {manifest.author}
                    </Link>
                  ) : (
                    <Typography variant="body2">{manifest.author}</Typography>
                  )}
                </Row>
              )}
              <Row label={t("tools.about.hosts")} help={t("tools.about.hostsHelp")}>
                {manifest.hosts.length ? (
                  <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: "wrap" }}>
                    {manifest.hosts.map((host) => (
                      <Chip key={host} size="small" label={host} sx={{ fontFamily: "monospace" }} />
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t("tools.about.noHosts")}
                  </Typography>
                )}
              </Row>
              {manifest.collection && (
                <Row label={t("tools.about.models")} help={t("tools.about.modelsHelp")}>
                  <Typography variant="body2">
                    {t("tools.about.modelCount", { count: manifest.collection.models.length })}
                  </Typography>
                </Row>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 2, pb: 2 }}>
            {tool.collectionId && (
              <Button
                startIcon={<CollectionsOutlinedIcon fontSize="small" />}
                onClick={() => {
                  onClose();
                  navigate(`/models/collections/${tool.collectionId}`);
                }}
                sx={{ mr: "auto" }}
              >
                {t("tools.about.openModels")}
              </Button>
            )}
            <Button onClick={onClose}>{t("tools.about.close")}</Button>
            {onOpen && (
              <Button variant="contained" onClick={() => onOpen(tool)}>
                {t("tools.about.open")}
              </Button>
            )}
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
