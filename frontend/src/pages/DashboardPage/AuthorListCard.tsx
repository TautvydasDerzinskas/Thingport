import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Avatar from "@mui/material/Avatar";
import StarIcon from "@mui/icons-material/Star";
import PersonIcon from "@mui/icons-material/Person";
import { dashboardApi, type DashboardAuthor } from "../../api/dashboard";
import SeeMoreDialog from "./SeeMoreDialog";
import AuthorHoverCard from "../../components/AuthorHoverCard";

type Props = {
  authors: DashboardAuthor[];
};

function AuthorRow({ author, rank, modelCountLabel, onClick }: {
  author: DashboardAuthor;
  rank: number;
  modelCountLabel: (count: number) => string;
  onClick: () => void;
}) {
  return (
    <AuthorHoverCard authorId={author.id}>
      <ListItemButton onClick={onClick} sx={{ borderRadius: 1, px: 1 }}>
        <Typography sx={{ width: 24, flexShrink: 0, color: "text.secondary", fontWeight: 600 }}>{rank}</Typography>
        <ListItemAvatar sx={{ minWidth: 48 }}>
          <Avatar src={author.avatar_url ?? undefined} sx={{ width: 40, height: 40 }}>
            <PersonIcon fontSize="small" />
          </Avatar>
        </ListItemAvatar>
        <ListItemText primary={author.name || author.handle || "—"} primaryTypographyProps={{ noWrap: true }} />
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, pl: 1 }}>
          {modelCountLabel(author.model_count)}
        </Typography>
      </ListItemButton>
    </AuthorHoverCard>
  );
}

/** Top Authors -- authors this user has the most models from, ranked by model count. 5-row
 *  preview with a See more dialog. Every row navigates to the author's page. */
export default function AuthorListCard({ authors }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const modelCountLabel = (count: number) => t("dashboard.topAuthors.modelCount", { count });

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, display: "flex", flexDirection: "column", borderColor: (theme) => (theme.palette.mode === "dark" ? "transparent" : "divider") }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, color: "primary.main" }}>
        <StarIcon />
        <Typography variant="h6" fontWeight={700} sx={{ color: (theme) => theme.thingport.headingText }}>{t("dashboard.topAuthors.title")}</Typography>
      </Box>

      {authors.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>{t("dashboard.topAuthors.empty")}</Typography>
      ) : (
        <List dense disablePadding>
          {authors.map((author, idx) => (
            <AuthorRow
              key={author.id}
              author={author}
              rank={idx + 1}
              modelCountLabel={modelCountLabel}
              onClick={() => navigate(`/authors/${author.id}`)}
            />
          ))}
        </List>
      )}

      <Button onClick={() => setDialogOpen(true)} sx={{ alignSelf: "flex-start", mt: 1 }}>
        {t("dashboard.seeMore")}
      </Button>

      <SeeMoreDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t("dashboard.topAuthors.title")}
        emptyText={t("dashboard.topAuthors.empty")}
        fetcher={dashboardApi.getTopAuthors}
        getKey={(author) => author.id}
        renderItem={(author, idx) => (
          <AuthorRow
            author={author}
            rank={idx + 1}
            modelCountLabel={modelCountLabel}
            onClick={() => { setDialogOpen(false); navigate(`/authors/${author.id}`); }}
          />
        )}
      />
    </Paper>
  );
}
