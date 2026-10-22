import type React from "react";
import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router-dom";
import CollectionsIcon from "@mui/icons-material/Collections";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import PersonIcon from "@mui/icons-material/Person";
import FolderIcon from "@mui/icons-material/Folder";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import NewReleasesIcon from "@mui/icons-material/NewReleases";
import ScheduleIcon from "@mui/icons-material/Schedule";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import StarIcon from "@mui/icons-material/Star";
import PublicIcon from "@mui/icons-material/Public";
import ThreeDRotationIcon from "@mui/icons-material/ThreeDRotation";
import InsightsIcon from "@mui/icons-material/Insights";
import { dashboardApi, type DashboardSummary } from "../../api/dashboard";
import type { DashboardWidgetId } from "../../api/settings";
import CountCard from "./CountCard";
import ModelListCard from "./ModelListCard";
import AuthorListCard from "./AuthorListCard";
import ProviderListCard from "./ProviderListCard";
import RecentlyAddedCard from "./RecentlyAddedCard";
import ClockCard from "./ClockCard";
import WeatherCard from "./WeatherCard";
import FeaturedModelCard from "./FeaturedModelCard";
import ActivityHeatmapCard from "./ActivityHeatmapCard";
import type { DashboardSkeleton } from "./DashboardCardSkeleton";
import type { PanelSketchKind } from "./PanelSketch";

export type WidgetSize = { w: number; h: number; minW: number; minH: number };

type WidgetContext = {
  summary: DashboardSummary;
  t: TFunction;
  navigate: NavigateFunction;
  onUnauthorized?: () => void;
};

export type DashboardWidget = {
  id: DashboardWidgetId;
  /** The widget's name in the settings dialog. */
  labelKey: string;
  /** Its tab and menu icon. */
  icon: React.ReactNode;
  /** Its size when added, in the wide grid's columns and rows, and the smallest it can be made. */
  size: WidgetSize;
  /** Its drawing in the settings dialog's Panels picker. */
  sketch: PanelSketchKind;
  /** Its placeholder while the summary loads. A widget without one fetches its own data, renders
   *  straight away, and mustn't read `summary`. */
  skeleton?: DashboardSkeleton;
  render: (ctx: WidgetContext) => React.ReactNode;
};

/** In menu order. A new widget is one entry here, plus its id in DashboardWidgetId and the backend, and a place in
 *  whichever preset templates should show it. */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  {
    id: "collectionCount",
    labelKey: "dashboard.collectionCount.label",
    icon: <CollectionsIcon fontSize="small" />,
    size: { w: 3, h: 2, minW: 2, minH: 2 },
    sketch: "count",
    skeleton: { kind: "count" },
    render: ({ summary, t, navigate }) => (
      <CountCard
        icon={<CollectionsIcon sx={{ fontSize: 32 }} />}
        count={summary.collection_count}
        label={t("dashboard.collectionCount.label")}
        onClick={() => navigate("/models/collections")}
      />
    ),
  },
  {
    id: "modelCount",
    labelKey: "dashboard.modelCount.label",
    icon: <ViewInArIcon fontSize="small" />,
    size: { w: 3, h: 2, minW: 2, minH: 2 },
    sketch: "count",
    skeleton: { kind: "count" },
    render: ({ summary, t, navigate }) => (
      <CountCard
        icon={<ViewInArIcon sx={{ fontSize: 32 }} />}
        count={summary.model_count}
        label={t("dashboard.modelCount.label")}
        onClick={() => navigate("/models")}
      />
    ),
  },
  {
    id: "authorCount",
    labelKey: "dashboard.authorCount.label",
    icon: <PersonIcon fontSize="small" />,
    size: { w: 3, h: 2, minW: 2, minH: 2 },
    sketch: "count",
    skeleton: { kind: "count" },
    render: ({ summary, t }) => (
      <CountCard
        icon={<PersonIcon sx={{ fontSize: 32 }} />}
        count={summary.author_count}
        label={t("dashboard.authorCount.label")}
      />
    ),
  },
  {
    id: "categoryCount",
    labelKey: "dashboard.categoryCount.label",
    icon: <FolderIcon fontSize="small" />,
    size: { w: 3, h: 2, minW: 2, minH: 2 },
    sketch: "count",
    skeleton: { kind: "count" },
    render: ({ summary, t, navigate }) => (
      <CountCard
        icon={<FolderIcon sx={{ fontSize: 32 }} />}
        count={summary.category_count}
        label={t("dashboard.categoryCount.label")}
        onClick={() => navigate("/models")}
      />
    ),
  },
  {
    id: "featuredModel",
    labelKey: "dashboard.featuredModel.title",
    icon: <ThreeDRotationIcon fontSize="small" />,
    size: { w: 5, h: 5, minW: 3, minH: 4 },
    sketch: "featured",
    render: ({ onUnauthorized }) => <FeaturedModelCard onUnauthorized={onUnauthorized} />,
  },
  {
    id: "activityHeatmap",
    labelKey: "dashboard.activityHeatmap.title",
    icon: <InsightsIcon fontSize="small" />,
    size: { w: 12, h: 3, minW: 4, minH: 3 },
    sketch: "heatmap",
    render: ({ onUnauthorized }) => <ActivityHeatmapCard onUnauthorized={onUnauthorized} />,
  },
  {
    id: "topViewed",
    labelKey: "dashboard.topViewed.title",
    icon: <VisibilityIcon fontSize="small" />,
    size: { w: 5, h: 4, minW: 3, minH: 3 },
    sketch: "models",
    skeleton: { kind: "list", rows: 3, footer: true },
    render: ({ summary, t }) => (
      <ModelListCard
        icon={<VisibilityIcon />}
        title={t("dashboard.topViewed.title")}
        models={summary.top_viewed}
        valueOf={(m) => m.view_count}
        valueLabel={(count) => t("dashboard.viewCount", { count })}
        emptyText={t("dashboard.topViewed.empty")}
        seeMoreLabel={t("dashboard.seeMore")}
        fetchMore={dashboardApi.getTopViewed}
      />
    ),
  },
  {
    id: "topPrinted",
    labelKey: "dashboard.topPrinted.title",
    icon: <PrintIcon fontSize="small" />,
    size: { w: 5, h: 4, minW: 3, minH: 3 },
    sketch: "models",
    skeleton: { kind: "list", rows: 3, footer: true },
    render: ({ summary, t }) => (
      <ModelListCard
        icon={<PrintIcon />}
        title={t("dashboard.topPrinted.title")}
        models={summary.top_printed}
        valueOf={(m) => m.print_count}
        valueLabel={(count) => t("dashboard.printCount", { count })}
        emptyText={t("dashboard.topPrinted.empty")}
        seeMoreLabel={t("dashboard.seeMore")}
        fetchMore={dashboardApi.getTopPrinted}
      />
    ),
  },
  {
    id: "recentlyAdded",
    labelKey: "dashboard.recentlyAdded.title",
    icon: <NewReleasesIcon fontSize="small" />,
    size: { w: 5, h: 4, minW: 3, minH: 3 },
    sketch: "models",
    skeleton: { kind: "list", rows: 3 },
    render: ({ summary }) => <RecentlyAddedCard models={summary.recently_added} />,
  },
  {
    id: "clock",
    labelKey: "dashboard.clock.label",
    icon: <ScheduleIcon fontSize="small" />,
    size: { w: 4, h: 2, minW: 2, minH: 2 },
    sketch: "clock",
    render: () => <ClockCard />,
  },
  {
    id: "weather",
    labelKey: "dashboard.weather.label",
    icon: <WbSunnyIcon fontSize="small" />,
    size: { w: 4, h: 2, minW: 3, minH: 2 },
    sketch: "weather",
    render: () => <WeatherCard />,
  },
  {
    id: "topAuthors",
    labelKey: "dashboard.topAuthors.title",
    icon: <StarIcon fontSize="small" />,
    size: { w: 4, h: 6, minW: 3, minH: 3 },
    sketch: "authors",
    skeleton: { kind: "list", rows: 5, footer: true },
    render: ({ summary }) => <AuthorListCard authors={summary.top_authors} />,
  },
  {
    id: "topProviders",
    labelKey: "dashboard.topProviders.title",
    icon: <PublicIcon fontSize="small" />,
    size: { w: 4, h: 4, minW: 3, minH: 3 },
    sketch: "providers",
    skeleton: { kind: "list", rows: 4, avatar: false },
    render: ({ summary }) => <ProviderListCard providers={summary.top_providers} />,
  },
];

const BY_ID = new Map(DASHBOARD_WIDGETS.map((widget) => [widget.id, widget]));

export function widgetById(id: DashboardWidgetId): DashboardWidget | undefined {
  return BY_ID.get(id);
}
