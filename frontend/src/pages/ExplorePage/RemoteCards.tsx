import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import type { RemoteCollectionCard, RemoteModelCard } from "../../api/social";
import InstanceChip from "../../components/InstanceChip";
import UserAvatar from "../../components/UserAvatar";

/** A card on a partner's model or collection: like the model cards, with which instance it's on over its picture. */
function CardShell({
  to,
  label,
  picture,
  children,
}: {
  to: string;
  label: string;
  picture: React.ReactNode;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const theme = useTheme();
  return (
    <ButtonBase
      onClick={() => navigate(to)}
      aria-label={label}
      sx={{
        display: "block",
        width: "100%",
        textAlign: "left",
        overflow: "hidden",
        borderRadius: "12px",
        bgcolor: theme.palette.mode === "dark" ? theme.thingport.pageBackground : theme.palette.grey[100],
        transition: "background-color .15s ease, box-shadow .15s ease, transform .15s ease",
        "&:hover": { bgcolor: "background.paper", boxShadow: 6, transform: "translateY(-2px)" },
        "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
      }}
    >
      <Box sx={{ position: "relative", width: "100%", aspectRatio: "4 / 3", overflow: "hidden" }}>{picture}</Box>
      <Stack spacing={0.5} sx={{ px: 1.5, py: 1.25, minWidth: 0 }}>
        {children}
      </Stack>
    </ButtonBase>
  );
}

function Picture({ url, icon }: { url: string | null; icon: React.ReactNode }) {
  return url ? (
    <Box component="img" src={url} alt="" loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {icon}
    </Box>
  );
}

function Owner({ owner }: { owner: RemoteModelCard["owner"] }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, color: "text.secondary" }}>
      <UserAvatar user={owner} size={20} />
      <Typography variant="caption" noWrap>
        {owner.display_name}
      </Typography>
    </Stack>
  );
}

export function RemoteModelCardView({ model }: { model: RemoteModelCard }) {
  const { t } = useTranslation("models");
  return (
    <CardShell
      to={`/explore/elsewhere/models/${model.id}`}
      label={model.title}
      picture={
        <>
          <Picture
            url={model.thumb_url}
            icon={<ViewInArOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />}
          />
          <Box sx={{ position: "absolute", top: 8, left: 8, maxWidth: "calc(100% - 16px)" }}>
            <InstanceChip instance={model.instance} label={model.instance.name} overlay />
          </Box>
        </>
      }
    >
      <Typography variant="body2" fontWeight={600} noWrap title={model.title}>
        {model.title}
      </Typography>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Owner owner={model.owner} />
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {t("explore.elsewhere.fileCount", { count: model.file_count })}
        </Typography>
      </Stack>
    </CardShell>
  );
}

export function RemoteCollectionCardView({ collection }: { collection: RemoteCollectionCard }) {
  const { t } = useTranslation("models");
  const covers = collection.cover_urls;
  return (
    <CardShell
      to={`/explore/elsewhere/collections/${collection.id}`}
      label={collection.name}
      picture={
        <>
          {covers.length >= 4 ? (
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", width: "100%", height: "100%" }}>
              {covers.slice(0, 4).map((url) => (
                <Box
                  key={url}
                  component="img"
                  src={url}
                  alt=""
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover", minHeight: 0 }}
                />
              ))}
            </Box>
          ) : (
            <Picture
              url={covers[0] ?? null}
              icon={<CollectionsOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />}
            />
          )}
          <Box sx={{ position: "absolute", top: 8, left: 8, maxWidth: "calc(100% - 16px)" }}>
            <InstanceChip instance={collection.instance} label={collection.instance.name} overlay />
          </Box>
        </>
      }
    >
      <Typography variant="body2" fontWeight={600} noWrap title={collection.name}>
        {collection.name}
      </Typography>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Owner owner={collection.owner} />
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {t("explore.modelCount", { count: collection.item_count })}
        </Typography>
      </Stack>
    </CardShell>
  );
}
