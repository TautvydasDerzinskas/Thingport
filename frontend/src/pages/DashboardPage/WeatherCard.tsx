import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import FilterDramaIcon from "@mui/icons-material/FilterDrama";
import CloudIcon from "@mui/icons-material/Cloud";
import WbCloudyIcon from "@mui/icons-material/WbCloudy";
import GrainIcon from "@mui/icons-material/Grain";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import AcUnitIcon from "@mui/icons-material/AcUnit";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import type { WeatherLocation } from "../../api/settings";
import { useWeatherLocation } from "../../hooks/useWeatherLocation";
import {
  conditionOf,
  fetchWeather,
  placeName,
  searchPlaces,
  type Condition,
  type Place,
  type TemperatureUnit,
  type Weather,
} from "../../utils/weather";
import { MONO_FONT } from "./ClockCard";
import DashboardCard from "./DashboardCard";

const ICONS: Record<Condition, typeof WbSunnyIcon> = {
  clear: WbSunnyIcon,
  partly: FilterDramaIcon,
  cloudy: CloudIcon,
  fog: WbCloudyIcon,
  drizzle: GrainIcon,
  rain: WaterDropIcon,
  snow: AcUnitIcon,
  storm: ThunderstormIcon,
};

const SEARCH_DEBOUNCE_MS = 300;

const placeLabel = (place: Place) => [place.name, place.admin1, place.country].filter(Boolean).join(", ");

/** Detect from the browser, or search for a place. Browsers only share location over HTTPS or localhost. */
function LocationPicker({ onPick, onCancel }: { onPick: (location: WeatherLocation) => void; onCancel?: () => void }) {
  const { t, i18n } = useTranslation("app");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const canDetect = typeof navigator !== "undefined" && "geolocation" in navigator && window.isSecureContext;

  useEffect(() => {
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchPlaces(q, i18n.language)
        .then((found) => {
          // Only the newest query's answer lands, so a slow early one can't overwrite it.
          if (seq !== searchSeq.current) return;
          setResults(found);
          setStatus(found.length ? null : t("dashboard.weather.noPlaces", { query: q }));
        })
        .catch(() => seq === searchSeq.current && setStatus(t("dashboard.weather.searchFailed")))
        .finally(() => seq === searchSeq.current && setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, i18n.language, t]);

  const detect = () => {
    setDetecting(true);
    setStatus(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lon } = position.coords;
        const name = await placeName(lat, lon, i18n.language);
        setDetecting(false);
        onPick({ lat, lon, name, source: "device" });
      },
      (error) => {
        setDetecting(false);
        setStatus(
          error.code === error.PERMISSION_DENIED
            ? t("dashboard.weather.detectBlocked")
            : t("dashboard.weather.detectFailed"),
        );
      },
      { timeout: 15000 },
    );
  };

  return (
    <Stack spacing={1.25}>
      <Tooltip title={canDetect ? "" : t("dashboard.weather.detectUnavailable")}>
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={detecting ? <CircularProgress size={14} color="inherit" /> : <MyLocationIcon />}
            onClick={detect}
            disabled={!canDetect || detecting}
          >
            {detecting ? t("dashboard.weather.detecting") : t("dashboard.weather.detect")}
          </Button>
        </span>
      </Tooltip>
      <TextField
        size="small"
        label={t("dashboard.weather.searchLabel")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        slotProps={{ input: { endAdornment: searching ? <CircularProgress size={14} /> : undefined } }}
      />
      {results.length > 0 && (
        <List dense disablePadding>
          {results.map((place) => (
            <ListItemButton
              key={`${place.latitude},${place.longitude}`}
              sx={{ borderRadius: 1 }}
              onClick={() => onPick({ lat: place.latitude, lon: place.longitude, name: place.name, source: "manual" })}
            >
              <ListItemText primary={placeLabel(place)} primaryTypographyProps={{ noWrap: true }} />
            </ListItemButton>
          ))}
        </List>
      )}
      {status && (
        <Typography variant="caption" color="text.secondary">
          {status}
        </Typography>
      )}
      {onCancel && (
        <Button size="small" onClick={onCancel} sx={{ alignSelf: "flex-start" }}>
          {t("dashboard.weather.cancel")}
        </Button>
      )}
    </Stack>
  );
}

type Props = {
  unit: TemperatureUnit;
  /** The line with the forecast a few hours on. */
  showLater: boolean;
  /** This panel's own place; null uses the account's, as the one weather panel always did. */
  place: WeatherLocation | null;
  onPlace: (place: WeatherLocation | null) => void;
};

/** One place's weather. Several weather panels can each show their own place. */
export default function WeatherCard({ unit, showLater, place, onPlace }: Props) {
  const { t } = useTranslation("app");
  const [account, setAccount] = useWeatherLocation();
  const location = place ?? account;
  // Chosen here, a place is this panel's own. Forgetting it falls back to the account's place; forgetting that clears it.
  const setLocation = (picked: WeatherLocation | null) => (picked || place ? onPlace(picked) : setAccount(null));
  const lat = location?.lat;
  const lon = location?.lon;
  const [weather, setWeather] = useState<Weather | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  // By its coordinates: the place object is rebuilt with every render.
  useEffect(() => {
    setWeather(null);
    setFailed(false);
    if (lat === undefined || lon === undefined) return;
    let active = true;
    fetchWeather(lat, lon, unit)
      .then((result) => active && setWeather(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [lat, lon, unit]);

  const condition = weather ? conditionOf(weather.code) : null;
  const Icon = condition ? ICONS[condition] : null;
  const later = weather ? conditionOf(weather.later.code) : null;

  let body: React.ReactNode;
  if (location === undefined) body = <CircularProgress size={22} />;
  else if (!location || editing)
    body = (
      <Stack spacing={1.5}>
        {!location && (
          <Typography variant="body2" color="text.secondary">
            {t("dashboard.weather.setLocation")}
          </Typography>
        )}
        <LocationPicker
          onPick={(picked) => {
            setLocation(picked);
            setEditing(false);
          }}
          onCancel={location ? () => setEditing(false) : undefined}
        />
        {location && (
          <Button size="small" color="error" onClick={() => setLocation(null)} sx={{ alignSelf: "flex-start" }}>
            {t("dashboard.weather.forget")}
          </Button>
        )}
      </Stack>
    );
  else if (failed) body = <Typography color="text.secondary">{t("dashboard.weather.loadError")}</Typography>;
  else if (!weather || !Icon || !condition || !later) body = <CircularProgress size={22} />;
  else
    body = (
      <Stack spacing={0.75} sx={{ fontFamily: MONO_FONT }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Icon sx={{ fontSize: 34, color: "primary.main" }} />
          <Typography
            sx={{
              fontFamily: "inherit",
              fontSize: "2.75rem",
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: (theme) => theme.thingport.headingText,
            }}
          >
            {`${weather.temperature}°`}
            <Box component="span" sx={{ fontSize: "0.4em", fontWeight: 500, ml: 0.25, color: "text.secondary" }}>
              {unit === "fahrenheit" ? "F" : "C"}
            </Box>
          </Typography>
        </Stack>
        <Typography
          sx={{
            fontFamily: "inherit",
            fontSize: "0.8rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "text.secondary",
          }}
        >
          {`${t(`dashboard.weather.conditions.${condition}`)} · ${t("dashboard.weather.highLow", { high: weather.high, low: weather.low })}`}
        </Typography>
        {showLater && (
          <Typography sx={{ fontFamily: "inherit", fontSize: "0.75rem", color: "text.disabled" }}>
            {t("dashboard.weather.later", {
              hours: weather.later.hours,
              temperature: weather.later.temperature,
              condition: t(`dashboard.weather.conditions.${later}`).toLowerCase(),
            })}
          </Typography>
        )}
      </Stack>
    );

  return (
    <DashboardCard
      sx={{
        p: 3,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 1,
        position: "relative",
      }}
    >
      {location && !editing && (
        <Box sx={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography
            noWrap
            sx={{
              fontFamily: MONO_FONT,
              fontSize: "0.7rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "text.secondary",
              maxWidth: 160,
            }}
          >
            {location.name || t("dashboard.weather.yourArea")}
          </Typography>
          <Tooltip title={t("dashboard.weather.change")}>
            <IconButton size="small" onClick={() => setEditing(true)} aria-label={t("dashboard.weather.change")}>
              <PlaceOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      {body}
    </DashboardCard>
  );
}
