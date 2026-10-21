import React from "react";
import { useTranslation } from "react-i18next";
import ApiOutlinedIcon from "@mui/icons-material/ApiOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import type { ApiTokenInfo } from "../../api/auth";
import SectionedDialog from "../../components/SectionedDialog";
import McpPermissionsSection from "./McpPermissionsSection";
import RestPermissionsSection from "./RestPermissionsSection";

type Section = "rest" | "mcp";

type Props = {
  open: boolean;
  onClose: () => void;
  info: ApiTokenInfo;
  onChange: (info: ApiTokenInfo) => void;
  onUnauthorized?: () => void;
};

/** What the API token may do, a section per way of using it: reading the REST API, and MCP. */
export default function ApiTokenPermissionsDialog({ open, onClose, info, onChange, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [section, setSection] = React.useState<Section>("rest");

  const sections = [
    { id: "rest" as const, label: t("profile.apiToken.permissions.rest"), icon: <ApiOutlinedIcon fontSize="small" /> },
    {
      id: "mcp" as const,
      label: t("profile.apiToken.permissions.mcp"),
      icon: <SmartToyOutlinedIcon fontSize="small" />,
    },
  ];

  return (
    <SectionedDialog
      open={open}
      onClose={onClose}
      title={t("profile.apiToken.permissions.title")}
      sections={sections}
      section={section}
      onSectionChange={setSection}
    >
      {section === "rest" && <RestPermissionsSection info={info} onChange={onChange} onUnauthorized={onUnauthorized} />}
      {section === "mcp" && <McpPermissionsSection info={info} onChange={onChange} onUnauthorized={onUnauthorized} />}
    </SectionedDialog>
  );
}
