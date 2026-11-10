import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import type { Collection } from "../../api/collections";
import SharedAvatars from "../../components/SharedAvatars";
import { peopleNames } from "../../utils/peopleNames";

type Props = {
  sharedWith: NonNullable<Collection["shared_with"]>;
  /** Opens its form on who sees it. */
  onClick: () => void;
};

/** On the owner's own shared collection's page: who sees it, opening Share… when clicked. */
export default function SharedWithChip({ sharedWith, onClick }: Props) {
  const { t, i18n } = useTranslation(["models"]);
  const who = sharedWith.count
    ? peopleNames(
        sharedWith.people.map((person) => person.display_name),
        sharedWith.count,
        t,
        i18n.language,
      )
    : t("models:collections.form.sharedNobody");
  return (
    <Tooltip title={sharedWith.count ? t("models:collections.card.sharedWith", { names: who }) : who}>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        onClick={onClick}
        aria-label={t("models:collections.card.changeSharing", { who })}
        startIcon={
          sharedWith.count ? (
            <SharedAvatars people={sharedWith.people} size={20} />
          ) : (
            <GroupOutlinedIcon fontSize="small" />
          )
        }
        sx={{
          borderRadius: 999,
          borderColor: "divider",
          pl: sharedWith.count ? 0.5 : 1.25,
          whiteSpace: "nowrap",
          "& .MuiButton-startIcon": { ml: 0, mr: 0.75 },
        }}
      >
        {t("models:collections.detail.sharedWith", { count: sharedWith.count })}
      </Button>
    </Tooltip>
  );
}
