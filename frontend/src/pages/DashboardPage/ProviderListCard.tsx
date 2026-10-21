import { useTranslation } from "react-i18next";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import PublicIcon from "@mui/icons-material/Public";
import { printProviderInfo } from "../../constants/importProviders";
import type { DashboardProvider } from "../../api/dashboard";
import ProviderBadge from "../../components/ProviderBadge";
import { useProviderAbout } from "../../components/providerAbout/ProviderAboutProvider";

type Props = {
  providers: DashboardProvider[];
};

/** A small fixed set, so no "see more". A provider's row opens its About dialog; Thingport's own (uploads) has none. */
export default function ProviderListCard({ providers }: Props) {
  const { t } = useTranslation("app");

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        display: "flex",
        flexDirection: "column",
        borderColor: (theme) => (theme.palette.mode === "dark" ? "transparent" : "divider"),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, color: "primary.main" }}>
        <PublicIcon />
        <Typography variant="h6" fontWeight={700} sx={{ color: (theme) => theme.thingport.headingText }}>
          {t("dashboard.topProviders.title")}
        </Typography>
      </Box>

      {providers.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          {t("dashboard.topProviders.empty")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {providers.map((p) => (
            <ProviderRow
              key={p.provider ?? ""}
              provider={p.provider}
              countLabel={t("dashboard.topProviders.modelCount", { count: p.model_count })}
            />
          ))}
        </List>
      )}
    </Paper>
  );
}

function ProviderRow({ provider, countLabel }: { provider: string | null; countLabel: string }) {
  const { t } = useTranslation("app");
  const name = printProviderInfo(provider).label;
  const openAbout = useProviderAbout(provider);
  const content = (
    <>
      <ListItemAvatar sx={{ minWidth: 44 }}>
        <ProviderBadge provider={provider} size={32} interactive={false} sx={{ boxShadow: "none" }} />
      </ListItemAvatar>
      <ListItemText primary={name} primaryTypographyProps={{ noWrap: true, fontWeight: 600 }} />
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, pl: 1 }}>
        {countLabel}
      </Typography>
    </>
  );
  return openAbout ? (
    <ListItem disablePadding>
      <ListItemButton
        onClick={openAbout}
        aria-label={`${name}, ${countLabel}. ${t("providerAbout.aboutName", { name })}`}
        sx={{ borderRadius: 1, px: 1 }}
      >
        {content}
      </ListItemButton>
    </ListItem>
  ) : (
    <ListItem sx={{ px: 1 }}>{content}</ListItem>
  );
}
