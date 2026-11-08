import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { PrintProfilesView } from "../../../api/settings";
import HelpTip from "../../../components/HelpTip";
import ProfileList from "./ProfileList";
import ProfilePicker from "./ProfilePicker";
import ProfileTiles from "./ProfileTiles";
import { SectionCaption } from "./parts";
import type { ProfileViewProps } from "./types";

type Props = ProfileViewProps & { view: Exclude<PrintProfilesView, "off"> };

/** The side panel's print profiles, above Open, in the way the user picked in Configuration → Appearance. */
export default function PrintProfilesSection({ view, ...props }: Props) {
  const { t } = useTranslation("models");
  const { entries, otherFiles, selectedKey } = props;
  const total = entries.length + otherFiles.length;
  const position =
    Math.max(
      0,
      [...entries.map((e) => e.key), ...otherFiles.map((f) => f.key)].findIndex((key) => key === selectedKey),
    ) + 1;
  return (
    <Box>
      <SectionCaption
        end={
          view === "picker" && total > 1 ? (
            <Typography variant="caption" color="text.secondary">
              {t("detail.profiles.position", { n: position, count: total })}
            </Typography>
          ) : undefined
        }
      >
        {view === "picker" ? t("detail.profiles.labelOne") : t("detail.profiles.label", { count: entries.length })}
        <HelpTip text={t("detail.profiles.help")} />
      </SectionCaption>
      {view === "list" ? (
        <ProfileList {...props} />
      ) : view === "tiles" ? (
        <ProfileTiles {...props} />
      ) : (
        <ProfilePicker {...props} />
      )}
    </Box>
  );
}
