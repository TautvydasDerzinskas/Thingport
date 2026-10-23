import React from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
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
import DashboardCard, { DashboardCardBody, DashboardCardTitle, hasMore } from "./DashboardCard";
import SeeMoreDialog from "./SeeMoreDialog";

type Props = {
  /** Every provider, most models first. */
  providers: DashboardProvider[];
  count: number;
  showMore: boolean;
};

/** A provider's row opens its About dialog; Thingport's own (uploads) has none. */
export default function ProviderListCard({ providers, count, showMore }: Props) {
  const { t } = useTranslation("app");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const row = (p: DashboardProvider) => (
    <ProviderRow
      key={p.provider ?? ""}
      provider={p.provider}
      countLabel={t("dashboard.topProviders.modelCount", { count: p.model_count })}
    />
  );

  return (
    <DashboardCard scroll={false} sx={{ p: 2.5, display: "flex", flexDirection: "column" }}>
      <DashboardCardTitle
        icon={<PublicIcon />}
        title={t("dashboard.topProviders.title")}
        sx={{ mb: 1, flexShrink: 0 }}
      />

      <DashboardCardBody>
        {providers.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {t("dashboard.topProviders.empty")}
          </Typography>
        ) : (
          <List dense disablePadding>
            {providers.slice(0, count).map(row)}
          </List>
        )}
      </DashboardCardBody>

      {showMore && hasMore(providers.length, count, true) && (
        <Button onClick={() => setDialogOpen(true)} sx={{ alignSelf: "flex-start", mt: 1, flexShrink: 0 }}>
          {t("dashboard.seeMore")}
        </Button>
      )}

      <SeeMoreDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t("dashboard.topProviders.title")}
        emptyText={t("dashboard.topProviders.empty")}
        // The summary already holds every provider.
        fetcher={() => Promise.resolve(providers)}
        getKey={(p) => p.provider ?? ""}
        renderItem={(p) => row(p)}
      />
    </DashboardCard>
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
