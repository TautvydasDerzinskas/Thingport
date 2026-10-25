import React from "react";
import { useNavigate } from "react-router-dom";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import type { DashboardModel } from "../../api/dashboard";
import SeeMoreDialog from "./SeeMoreDialog";
import DashboardModelThumb from "./DashboardModelThumb";
import DashboardCard, { DashboardCardBody, DashboardCardTitle, hasMore } from "./DashboardCard";

type Props = {
  icon: React.ReactNode;
  title: string;
  models: DashboardModel[];
  valueOf: (model: DashboardModel) => number;
  valueLabel: (count: number) => string;
  emptyText: string;
  seeMoreLabel: string;
  fetchMore: () => Promise<DashboardModel[]>;
  /** How many rows show; the summary holds more. */
  count: number;
  showMore: boolean;
};

function ModelRow({
  model,
  rank,
  valueOf,
  valueLabel,
  onClick,
}: {
  model: DashboardModel;
  rank: number;
  valueOf: (model: DashboardModel) => number;
  valueLabel: (count: number) => string;
  onClick: () => void;
}) {
  return (
    <ListItemButton onClick={onClick} sx={{ borderRadius: 1, px: 1 }}>
      <Typography sx={{ width: 24, flexShrink: 0, color: "text.secondary", fontWeight: 600 }}>{rank}</Typography>
      <DashboardModelThumb model={model} />
      <ListItemText primary={model.name} primaryTypographyProps={{ noWrap: true }} />
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, pl: 1 }}>
        {valueLabel(valueOf(model))}
      </Typography>
    </ListItemButton>
  );
}

export default function ModelListCard({
  icon,
  title,
  models,
  valueOf,
  valueLabel,
  emptyText,
  seeMoreLabel,
  fetchMore,
  count,
  showMore,
}: Props) {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <DashboardCard scroll={false} sx={{ p: 2.5, display: "flex", flexDirection: "column" }}>
      <DashboardCardTitle icon={icon} title={title} sx={{ mb: 1, flexShrink: 0 }} />

      <DashboardCardBody>
        {models.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {emptyText}
          </Typography>
        ) : (
          <List dense disablePadding>
            {models.slice(0, count).map((model, idx) => (
              <ModelRow
                key={model.id}
                model={model}
                rank={idx + 1}
                valueOf={valueOf}
                valueLabel={valueLabel}
                onClick={() => navigate(`/models/${model.id}`)}
              />
            ))}
          </List>
        )}
      </DashboardCardBody>

      {showMore && hasMore(models.length, count) && (
        <Button onClick={() => setDialogOpen(true)} sx={{ alignSelf: "flex-start", mt: 1, flexShrink: 0 }}>
          {seeMoreLabel}
        </Button>
      )}

      <SeeMoreDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={title}
        emptyText={emptyText}
        fetcher={fetchMore}
        getKey={(model) => model.id}
        renderItem={(model, idx) => (
          <ModelRow
            model={model}
            rank={idx + 1}
            valueOf={valueOf}
            valueLabel={valueLabel}
            onClick={() => {
              setDialogOpen(false);
              navigate(`/models/${model.id}`);
            }}
          />
        )}
      />
    </DashboardCard>
  );
}
