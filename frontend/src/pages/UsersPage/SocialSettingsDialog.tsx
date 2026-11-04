import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import type { SocialSettings } from "../../api/social";
import ChatAnimation from "../../components/adminAnimations/ChatAnimation";
import HelpTip from "../../components/HelpTip";
import { PanelHeader } from "../../components/Layout/ConfigurationDialog/parts";
import SectionedDialog from "../../components/SectionedDialog";
import { AnimatedTile } from "../../components/storageAnimations/parts";

// What social features offer besides Explore, each switched on by itself: chats first, more to come beside them.

type Section = "chats";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: SocialSettings;
  saving: boolean;
  error: string | null;
  onDismissError: () => void;
  onChange: (patch: Partial<SocialSettings>) => void;
};

export default function SocialSettingsDialog({
  open,
  onClose,
  settings,
  saving,
  error,
  onDismissError,
  onChange,
}: Props) {
  const { t } = useTranslation("app");
  const [section, setSection] = React.useState<Section>("chats");
  const points = (["infoDirect", "infoRooms", "infoModels", "infoNotify", "infoOff"] as const).map((key) =>
    t(`adminSettings.social.chats.${key}`),
  );

  return (
    <SectionedDialog
      open={open}
      onClose={onClose}
      title={t("adminSettings.social.settingsTitle")}
      navLabel={t("adminSettings.social.settingsTitle")}
      sections={[
        { id: "chats", label: t("adminSettings.social.chats.label"), icon: <ForumOutlinedIcon fontSize="small" /> },
      ]}
      section={section}
      onSectionChange={setSection}
    >
      <PanelHeader title={t("adminSettings.social.chats.label")} subtitle={t("adminSettings.social.chats.summary")} />
      <Stack direction="row" spacing={2} alignItems="center">
        <AnimatedTile size={72}>
          <ChatAnimation key={String(settings.chats)} size={64} on={settings.chats} />
        </AnimatedTile>
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControlLabel
              sx={{ m: 0 }}
              control={
                <Switch
                  checked={settings.chats}
                  disabled={saving}
                  onChange={(event) => onChange({ chats: event.target.checked })}
                />
              }
              label={
                <Typography variant="body2" fontWeight={600} component="span">
                  {t("adminSettings.social.chats.switch")}
                  <HelpTip
                    text={[t("adminSettings.social.chats.infoTitle"), ...points].join(" ")}
                    content={
                      <>
                        <Typography variant="subtitle2" component="div" sx={{ mb: 0.5 }}>
                          {t("adminSettings.social.chats.infoTitle")}
                        </Typography>
                        <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                          {points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </Box>
                      </>
                    }
                  />
                </Typography>
              }
            />
            {saving && <CircularProgress size={16} />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {settings.chats ? t("adminSettings.social.chats.onHint") : t("adminSettings.social.chats.offHint")}
          </Typography>
        </Stack>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={onDismissError}>
          {error}
        </Alert>
      )}
    </SectionedDialog>
  );
}
