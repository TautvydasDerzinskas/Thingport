import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import { HttpError } from "../utils/fileUtils";
import { printOutById } from "../services/printLoader";
import { getForecast, getPlaceName, searchPlaces } from "../services/weatherService";
import {
  getDashboardSummary,
  getFeaturedModelId,
  getTopAuthorsList,
  getTopPrintedList,
  getTopViewedList,
  type DashboardAuthor,
  type DashboardModel,
  type DashboardProvider,
} from "../services/dashboardService";

const router = Router();
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
    const summary = await getDashboardSummary(req.userId!);
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
    const { lat, lon } = parseBody(z.object(coordinates), req.query);
    res.json(await fromWeatherService(() => getForecast(lat, lon)));
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

export default router;
