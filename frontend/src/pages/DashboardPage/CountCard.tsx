import Typography from "@mui/material/Typography";
import DashboardCard from "./DashboardCard";

type Props = {
  icon: React.ReactNode;
  count: number;
  label: string;
  onClick?: () => void;
};

/** With `onClick`, the whole card is a link. */
export default function CountCard({ icon, count, label, onClick }: Props) {
  return (
    <DashboardCard
      onClick={onClick}
      scroll={false}
      // Fits the smallest panel it can be, two rows: padding, icon, count and label add up to 140px.
      sx={{
        px: 3,
        py: 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 0.5,
        ...(onClick && {
          cursor: "pointer",
          transition: (theme) =>
            theme.transitions.create("background-color", { duration: theme.transitions.duration.shortest }),
          "&:hover": { bgcolor: "action.hover" },
        }),
      }}
    >
      <Typography component="div" sx={{ color: "primary.main", display: "flex" }}>
        {icon}
      </Typography>
      <Typography variant="h3" fontWeight={700} sx={{ lineHeight: 1, color: (theme) => theme.thingport.headingText }}>
        {count}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </DashboardCard>
  );
}
