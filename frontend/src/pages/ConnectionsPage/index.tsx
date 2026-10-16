import React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Stack from "@mui/material/Stack";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import SmtpTab from "./SmtpTab";
import DatabaseTab from "./DatabaseTab";
import FlaresolverrTab from "./FlaresolverrTab";

type Props = {
  onUnauthorized?: () => void;
};

const TABS = ["smtp", "database", "flaresolverr"] as const;
type TabKey = (typeof TABS)[number];

export default function ConnectionsPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  // ?tab=... opens one directly, as System Health's links do.
  const [searchParams] = useSearchParams();
  const asked = searchParams.get("tab");
  const [tab, setTab] = React.useState<TabKey>(TABS.find((key) => key === asked) ?? "smtp");

  return (
    <Stack spacing={3}>
      <Tabs
        value={tab}
        onChange={(_e, value) => setTab(value)}
        sx={{ borderBottom: "1px solid", borderColor: "divider" }}
      >
        <Tab value="smtp" label={t("adminSettings.smtp.tabLabel")} />
        <Tab value="database" label={t("adminSettings.database.tabLabel")} />
        <Tab value="flaresolverr" label={t("adminSettings.flaresolverr.tabLabel")} />
      </Tabs>
      {tab === "smtp" && <SmtpTab onUnauthorized={onUnauthorized} />}
      {tab === "database" && <DatabaseTab onUnauthorized={onUnauthorized} />}
      {tab === "flaresolverr" && <FlaresolverrTab onUnauthorized={onUnauthorized} />}
    </Stack>
  );
}
