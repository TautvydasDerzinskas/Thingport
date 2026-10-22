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
import RssFeedIcon from "@mui/icons-material/RssFeed";
import MemoryIcon from "@mui/icons-material/Memory";
import MonitorHeartOutlinedIcon from "@mui/icons-material/MonitorHeartOutlined";
import AppsIcon from "@mui/icons-material/Apps";
import { dashboardApi, type DashboardSummary } from "../../api/dashboard";
import type { DashboardWidgetId, WidgetSettingValues } from "../../api/settings";
import CountCard from "./CountCard";
import ModelListCard from "./ModelListCard";
import AuthorListCard from "./AuthorListCard";
import ProviderListCard from "./ProviderListCard";
import RecentlyAddedCard from "./RecentlyAddedCard";
import ClockCard from "./ClockCard";
import WeatherCard from "./WeatherCard";
import FeaturedModelCard from "./FeaturedModelCard";
import ActivityHeatmapCard from "./ActivityHeatmapCard";
import RssCard from "./RssCard";
import CpuCard from "./CpuCard";
import UptimeCard from "./UptimeCard";
import LauncherCard, { type LauncherIconStyle } from "./LauncherCard";
import type { DashboardSkeleton } from "./DashboardCardSkeleton";
import type { PanelSketchKind } from "./PanelSketch";

export type WidgetSize = { w: number; h: number; minW: number; minH: number };

/** One of a widget's options, in its settings dialog. Values are kept as strings or booleans, so they store as-is. */
export type WidgetSetting = (
  | {
      key: string;
      kind: "choice";
      labelKey: string;
      /** Shown as a segmented control; `label` for a value that needs no translation, like a number. */
      options: { value: string; label?: string; labelKey?: string }[];
      default: string;
    }
  | { key: string; kind: "toggle"; labelKey: string; default: boolean }
  | {
      key: string;
      kind: "urls";
      labelKey: string;
      /** Shown in the empty field, e.g. an example feed address. */
      placeholderKey: string;
      max: number;
      default: string[];
    }
  | { key: string; kind: "links"; labelKey: string; max: number; default: LauncherLink[] }
) & {
  /** Offered to admins only. */
  adminOnly?: boolean;
};

/** Every option of a widget, the user's choice or the default. */
export type ResolvedSettings = Record<string, string | boolean | string[] | LauncherLink[]>;

/** A launcher item. `icon` is an image address or a path on Thingport itself; empty tries the site's own icon. */
export type LauncherLink = { name: string; url: string; icon: string };

type WidgetContext = {
  summary: DashboardSummary;
  settings: ResolvedSettings;
  isAdmin: boolean;
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
  skeleton?: (settings: ResolvedSettings) => DashboardSkeleton;
  /** What the user can change about it, from the cog on its panel while editing. */
  settings?: WidgetSetting[];
  /** Offered to admins only, e.g. one showing the server's own stats. */
  adminOnly?: boolean;
  render: (ctx: WidgetContext) => React.ReactNode;
};

/** How many rows a list panel can show; the backend's summary holds the most of these. */
export const LIST_COUNTS = ["3", "5", "7", "10"];
const LIST_SETTINGS: WidgetSetting[] = [
  {
    key: "count",
    kind: "choice",
    labelKey: "dashboard.settings.count",
    options: LIST_COUNTS.map((value) => ({ value, label: value })),
    default: "5",
  },
  { key: "showMore", kind: "toggle", labelKey: "dashboard.settings.showMore", default: true },
];
const listSkeleton = (settings: ResolvedSettings): DashboardSkeleton => ({
  kind: "list",
  rows: Number(settings.count),
  footer: settings.showMore === true,
});

/** In menu order. A new widget is one entry here, plus its id in DashboardWidgetId and the backend, and a place in
 *  whichever preset templates should show it. */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  {
    id: "collectionCount",
    labelKey: "dashboard.collectionCount.label",
    icon: <CollectionsIcon fontSize="small" />,
    size: { w: 3, h: 2, minW: 2, minH: 2 },
    sketch: "count",
    skeleton: () => ({ kind: "count" }),
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
    skeleton: () => ({ kind: "count" }),
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
    skeleton: () => ({ kind: "count" }),
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
    skeleton: () => ({ kind: "count" }),
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
    size: { w: 5, h: 5, minW: 3, minH: 3 },
    sketch: "models",
    skeleton: listSkeleton,
    settings: LIST_SETTINGS,
    render: ({ summary, t, settings }) => (
      <ModelListCard
        count={Number(settings.count)}
        showMore={settings.showMore === true}
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
    size: { w: 5, h: 5, minW: 3, minH: 3 },
    sketch: "models",
    skeleton: listSkeleton,
    settings: LIST_SETTINGS,
    render: ({ summary, t, settings }) => (
      <ModelListCard
        count={Number(settings.count)}
        showMore={settings.showMore === true}
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
    size: { w: 5, h: 5, minW: 3, minH: 3 },
    sketch: "models",
    skeleton: listSkeleton,
    settings: LIST_SETTINGS,
    render: ({ summary, settings }) => (
      <RecentlyAddedCard
        models={summary.recently_added}
        count={Number(settings.count)}
        showMore={settings.showMore === true}
      />
    ),
  },
  {
    id: "clock",
    labelKey: "dashboard.clock.label",
    icon: <ScheduleIcon fontSize="small" />,
    size: { w: 4, h: 2, minW: 2, minH: 2 },
    sketch: "clock",
    settings: [
      {
        key: "hourCycle",
        kind: "choice",
        labelKey: "dashboard.settings.hourCycle",
        options: [
          { value: "24", labelKey: "dashboard.settings.hour24" },
          { value: "12", labelKey: "dashboard.settings.hour12" },
        ],
        default: "24",
      },
      { key: "showDate", kind: "toggle", labelKey: "dashboard.settings.showDate", default: true },
      { key: "showGreeting", kind: "toggle", labelKey: "dashboard.settings.showGreeting", default: true },
    ],
    render: ({ settings }) => (
      <ClockCard
        hourCycle={settings.hourCycle === "12" ? "12" : "24"}
        showDate={settings.showDate === true}
        showGreeting={settings.showGreeting === true}
      />
    ),
  },
  {
    id: "weather",
    labelKey: "dashboard.weather.label",
    icon: <WbSunnyIcon fontSize="small" />,
    size: { w: 4, h: 2, minW: 3, minH: 2 },
    sketch: "weather",
    settings: [
      {
        key: "unit",
        kind: "choice",
        labelKey: "dashboard.settings.unit",
        options: [
          { value: "celsius", label: "°C" },
          { value: "fahrenheit", label: "°F" },
        ],
        default: "celsius",
      },
      { key: "showLater", kind: "toggle", labelKey: "dashboard.settings.showLater", default: true },
    ],
    render: ({ settings }) => (
      <WeatherCard
        unit={settings.unit === "fahrenheit" ? "fahrenheit" : "celsius"}
        showLater={settings.showLater === true}
      />
    ),
  },
  {
    id: "topAuthors",
    labelKey: "dashboard.topAuthors.title",
    icon: <StarIcon fontSize="small" />,
    size: { w: 4, h: 5, minW: 3, minH: 3 },
    sketch: "authors",
    skeleton: listSkeleton,
    settings: LIST_SETTINGS,
    render: ({ summary, settings }) => (
      <AuthorListCard
        authors={summary.top_authors}
        count={Number(settings.count)}
        showMore={settings.showMore === true}
      />
    ),
  },
  {
    id: "topProviders",
    labelKey: "dashboard.topProviders.title",
    icon: <PublicIcon fontSize="small" />,
    size: { w: 4, h: 4, minW: 3, minH: 3 },
    sketch: "providers",
    skeleton: (settings) => ({ ...listSkeleton(settings), avatar: false }),
    settings: LIST_SETTINGS,
    render: ({ summary, settings }) => (
      <ProviderListCard
        providers={summary.top_providers}
        count={Number(settings.count)}
        showMore={settings.showMore === true}
      />
    ),
  },
  {
    id: "rss",
    labelKey: "dashboard.rss.title",
    icon: <RssFeedIcon fontSize="small" />,
    size: { w: 4, h: 5, minW: 3, minH: 3 },
    sketch: "rss",
    settings: [
      {
        key: "feeds",
        kind: "urls",
        labelKey: "dashboard.settings.feeds",
        placeholderKey: "dashboard.settings.feedPlaceholder",
        max: 10,
        default: [],
      },
      LIST_SETTINGS[0],
      { key: "showDates", kind: "toggle", labelKey: "dashboard.settings.showDates", default: true },
    ],
    render: ({ settings, onUnauthorized }) => (
      <RssCard
        onUnauthorized={onUnauthorized}
        feeds={settings.feeds as string[]}
        count={Number(settings.count)}
        showDates={settings.showDates === true}
      />
    ),
  },
  {
    id: "cpu",
    labelKey: "dashboard.cpu.title",
    icon: <MemoryIcon fontSize="small" />,
    size: { w: 4, h: 4, minW: 3, minH: 3 },
    sketch: "cpu",
    // It describes the machine Thingport runs on.
    adminOnly: true,
    settings: [
      { key: "showLoad", kind: "toggle", labelKey: "dashboard.settings.showLoad", default: true },
      { key: "showMemory", kind: "toggle", labelKey: "dashboard.settings.showMemory", default: true },
    ],
    render: ({ settings, onUnauthorized }) => (
      <CpuCard
        showLoad={settings.showLoad === true}
        showMemory={settings.showMemory === true}
        onUnauthorized={onUnauthorized}
      />
    ),
  },
  {
    id: "uptime",
    labelKey: "dashboard.uptime.title",
    icon: <MonitorHeartOutlinedIcon fontSize="small" />,
    size: { w: 4, h: 4, minW: 3, minH: 2 },
    sketch: "uptime",
    settings: [
      {
        key: "urls",
        kind: "urls",
        labelKey: "dashboard.settings.monitors",
        placeholderKey: "dashboard.settings.monitorPlaceholder",
        max: 20,
        default: [],
      },
      // How long the server has been up describes the host, so only admins get it.
      { key: "showServer", kind: "toggle", labelKey: "dashboard.settings.showServer", default: true, adminOnly: true },
    ],
    render: ({ settings, isAdmin, onUnauthorized }) => (
      <UptimeCard
        urls={settings.urls as string[]}
        showServer={isAdmin && settings.showServer === true}
        onUnauthorized={onUnauthorized}
      />
    ),
  },
  {
    id: "launcher",
    labelKey: "dashboard.launcher.title",
    icon: <AppsIcon fontSize="small" />,
    size: { w: 4, h: 2, minW: 2, minH: 2 },
    sketch: "launcher",
    settings: [
      {
        key: "items",
        kind: "links",
        labelKey: "dashboard.settings.links",
        max: 100,
        default: [
          { name: "Thingport", url: "https://thingport.net", icon: "/icon-192.png" },
          {
            name: "GitHub",
            url: "https://github.com/TautvydasDerzinskas/Thingport",
            icon: "https://github.com/favicon.ico",
          },
        ],
      },
      {
        key: "iconStyle",
        kind: "choice",
        labelKey: "dashboard.settings.iconStyle",
        options: [
          { value: "colored", labelKey: "dashboard.settings.iconColored" },
          { value: "mono", labelKey: "dashboard.settings.iconMono" },
          { value: "grayed", labelKey: "dashboard.settings.iconGrayed" },
        ],
        default: "colored",
      },
      {
        key: "limit",
        kind: "choice",
        labelKey: "dashboard.settings.limit",
        options: [
          { value: "8", label: "8" },
          { value: "12", label: "12" },
          { value: "24", label: "24" },
          { value: "all", labelKey: "dashboard.settings.limitAll" },
        ],
        default: "12",
      },
      { key: "search", kind: "toggle", labelKey: "dashboard.settings.search", default: false },
    ],
    render: ({ settings }) => (
      <LauncherCard
        items={settings.items as LauncherLink[]}
        iconStyle={settings.iconStyle as LauncherIconStyle}
        limit={settings.limit === "all" ? null : Number(settings.limit)}
        search={settings.search === true}
      />
    ),
  },
];

const BY_ID = new Map(DASHBOARD_WIDGETS.map((widget) => [widget.id, widget]));

export function widgetById(id: DashboardWidgetId): DashboardWidget | undefined {
  return BY_ID.get(id);
}

/** The widget's options as stored, with anything missing or no longer offered replaced by its default. */
export function resolveSettings(widget: DashboardWidget, stored: WidgetSettingValues | undefined): ResolvedSettings {
  const resolved: ResolvedSettings = {};
  for (const setting of widget.settings ?? []) {
    const value = stored?.[setting.key];
    if (setting.kind === "toggle") resolved[setting.key] = typeof value === "boolean" ? value : setting.default;
    else if (setting.kind === "links")
      resolved[setting.key] = Array.isArray(value)
        ? value.flatMap((entry) => (typeof entry === "object" ? (cleanLink(entry) ?? []) : [])).slice(0, setting.max)
        : setting.default;
    else if (setting.kind === "urls")
      resolved[setting.key] = Array.isArray(value)
        ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && isWebUrl(entry)))].slice(
            0,
            setting.max,
          )
        : setting.default;
    else
      resolved[setting.key] = setting.options.some((option) => option.value === value)
        ? (value as string)
        : setting.default;
  }
  return resolved;
}

/** A stored launcher item, or null when it isn't one: no web address, or a name and icon that won't do. */
export function cleanLink(entry: Record<string, string>): LauncherLink | null {
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!isWebUrl(url)) return null;
  const icon = typeof entry.icon === "string" ? entry.icon.trim() : "";
  return {
    name: (typeof entry.name === "string" && entry.name.trim()) || new URL(url).host,
    url,
    // An image on the web, or one Thingport serves itself; never a script or another scheme.
    icon: isWebUrl(icon) || /^\/(?!\/)/.test(icon) ? icon : "",
  };
}

/** Only http(s) addresses: what the server will fetch for a feed or a monitor. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether the user may use a widget, or one of its options. */
export function allowed(item: { adminOnly?: boolean }, isAdmin: boolean): boolean {
  return !item.adminOnly || isAdmin;
}
