import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import { HttpError } from "../utils/fileUtils";
import { printOutById } from "../services/printLoader";
import { TEMPERATURE_UNITS, getForecast, getPlaceName, searchPlaces } from "../services/weatherService";
import { checkUrls, getFeeds, isWebUrl } from "../services/dashboardFeedsService";
import { getSystemStats } from "../services/systemStatsService";
import { TRENDING_PROVIDERS, getTrending } from "../services/providerTrendingService";
import {
  getDashboardSummary,
  getFeaturedModelId,
  getRecentlyAddedList,
  getTopAuthorsList,
  getTopPrintedList,
  getTopViewedList,
  type DashboardAuthor,
  type DashboardModel,
  type DashboardProvider,
} from "../services/dashboardService";

const router = Router();

// The most a dashboard list panel can be set to show; kept in sync by hand with the frontend's LIST_COUNTS.
const DASHBOARD_LIST_MAX = 10;
router.use(requireAuth);

function modelOut(m: DashboardModel) {
  return {
    id: m.id,
    name: m.name,
    thumb_url: m.thumbUrl,
    render_url: m.renderUrl,
    view_count: m.viewCount,
    print_count: m.printCount,
    created_at: m.createdAt,
  };
}

function authorOut(a: DashboardAuthor) {
  return {
    id: a.id,
    name: a.name,
    handle: a.handle,
    avatar_url: a.avatarUrl,
    model_count: a.modelCount,
  };
}

function providerOut(p: DashboardProvider) {
  return { provider: p.provider, model_count: p.modelCount };
}

// The routes below back each card's "see more" dialog.
router.get(
  "/dashboard/summary",
  asyncHandler(async (req, res) => {
    const summary = await getDashboardSummary(req.userId!, {
      models: DASHBOARD_LIST_MAX,
      authors: DASHBOARD_LIST_MAX,
      recent: DASHBOARD_LIST_MAX,
    });
    res.json({
      collection_count: summary.collectionCount,
      model_count: summary.modelCount,
      author_count: summary.authorCount,
      category_count: summary.categoryCount,
      top_viewed: summary.topViewed.map(modelOut),
      top_printed: summary.topPrinted.map(modelOut),
      top_authors: summary.topAuthors.map(authorOut),
      top_providers: summary.topProviders.map(providerOut),
      recently_added: summary.recentlyAdded.map(modelOut),
    });
  }),
);

router.get(
  "/dashboard/top-viewed",
  asyncHandler(async (req, res) => {
    res.json((await getTopViewedList(req.userId!)).map(modelOut));
  }),
);

router.get(
  "/dashboard/top-printed",
  asyncHandler(async (req, res) => {
    res.json((await getTopPrintedList(req.userId!)).map(modelOut));
  }),
);

router.get(
  "/dashboard/top-authors",
  asyncHandler(async (req, res) => {
    res.json((await getTopAuthorsList(req.userId!)).map(authorOut));
  }),
);

const featuredQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
router.get(
  "/dashboard/recently-added",
  asyncHandler(async (req, res) => {
    res.json((await getRecentlyAddedList(req.userId!)).map(modelOut));
  }),
);

router.get(
  "/dashboard/featured",
  asyncHandler(async (req, res) => {
    const { date } = parseBody(featuredQuerySchema, req.query);
    const printId = await getFeaturedModelId(req.userId!, date ?? new Date().toISOString().slice(0, 10));
    res.json({ print: printId ? await printOutById(req.userId!, printId) : null });
  }),
);

const coordinates = {
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
};
// A language tag like "en" or "lt", passed on so place names come back in it.
const language = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/)
  .default("en");

async function fromWeatherService<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    throw new HttpError(502, "The weather service didn't answer", "WEATHER_UNAVAILABLE");
  }
}

router.get(
  "/dashboard/weather",
  asyncHandler(async (req, res) => {
    const { lat, lon, unit } = parseBody(
      z.object({ ...coordinates, unit: z.enum(TEMPERATURE_UNITS).default("celsius") }),
      req.query,
    );
    res.json(await fromWeatherService(() => getForecast(lat, lon, unit)));
  }),
);

router.get(
  "/dashboard/weather/places",
  asyncHandler(async (req, res) => {
    const { q, lang } = parseBody(z.object({ q: z.string().trim().min(2).max(100), lang: language }), req.query);
    res.json({ places: await fromWeatherService(() => searchPlaces(q, lang)) });
  }),
);

router.get(
  "/dashboard/weather/place-name",
  asyncHandler(async (req, res) => {
    const { lat, lon, lang } = parseBody(z.object({ ...coordinates, lang: language }), req.query);
    res.json({ name: await getPlaceName(lat, lon, lang) });
  }),
);

// `?url=a&url=b`: the panel's URLs, each http(s).
const urlList = (max: number) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]),
    z.array(z.string().max(2048).refine(isWebUrl, "Only http and https addresses")).min(1).max(max),
  );

router.get(
  "/dashboard/feeds",
  asyncHandler(async (req, res) => {
    const { url } = parseBody(z.object({ url: urlList(10) }), req.query);
    res.json(await getFeeds(url));
  }),
);

router.get(
  "/dashboard/monitors",
  asyncHandler(async (req, res) => {
    const { url } = parseBody(z.object({ url: urlList(20) }), req.query);
    res.json({ results: await checkUrls(url) });
  }),
);

// The machine Thingport runs on: only admins see it.
router.get(
  "/dashboard/system",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await getSystemStats());
  }),
);

// A provider's trending models; the panel asks for one provider at a time, as the user picks it.
router.get(
  "/dashboard/trending",
  asyncHandler(async (req, res) => {
    const { provider } = parseBody(z.object({ provider: z.enum(TRENDING_PROVIDERS) }), req.query);
    try {
      res.json(await getTrending(provider, req.userId!));
    } catch {
      throw new HttpError(502, "The provider didn't answer", "PROVIDER_UNAVAILABLE");
    }
  }),
);

export default router;
