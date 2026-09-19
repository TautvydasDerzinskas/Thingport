import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import InputBase from "@mui/material/InputBase";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CollectionsIcon from "@mui/icons-material/Collections";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import { UnauthorizedError } from "../../../api/client";
import { type SearchResult, searchApi } from "../../../api/search";
import { printsApi } from "../../../api/prints";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

type Props = {
  onUnauthorized?: () => void;
};

/** The global search box: models (primary), collections, and tags matching name/description --
 *  see backend's searchService.ts, which does the actual ranking (Postgres full-text search, name
 *  matches outrank description matches). Debounced-as-you-type, results in a dropdown below the
 *  box; picking one navigates straight there. Lives centered in TopBar, always mounted regardless
 *  of route (like AddMenu/NotificationBell/UserMenu next to it). */
export default function GlobalSearch({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The dropdown's width is pinned to this (not a fixed constant) so it always exactly matches
  // the search box, not just approximates it -- the box itself is fluid (TopBar's center grid
  // column is `minmax(0, 480px)`, so its real width varies with the window). Tracked live via
  // ResizeObserver rather than read once, so resizing the window (or collapsing the sidebar,
  // which changes how much room the center column has) keeps them in sync.
  const [anchorWidth, setAnchorWidth] = useState<number>();
  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const update = () => setAnchorWidth(el.offsetWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await searchApi.search(debouncedQuery);
        if (!cancelled) setResult(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          onUnauthorized?.();
          return;
        }
        console.error(err);
        setError(t("app:search.failed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const closeDropdown = () => setFocused(false);

  const goTo = (path: string) => {
    closeDropdown();
    setQuery("");
    navigate(path);
  };

  const trimmedQuery = query.trim();
  const dropdownOpen = focused && trimmedQuery.length >= MIN_QUERY_LENGTH;
  const hasResults = Boolean(result && (result.models.length || result.collections.length || result.tags.length));

  return (
    <Box ref={anchorRef} sx={{ position: "relative", width: "100%" }}>
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1.25,
          py: 0.25,
          borderRadius: 999,
          bgcolor: (theme) => theme.thingport.pageBackground,
        }}
      >
        <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
        <InputBase
          fullWidth
          size="small"
          placeholder={t("app:search.placeholder") ?? undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
              closeDropdown();
            }
          }}
          sx={{ fontSize: 14 }}
        />
        {query && (
          <IconButton size="small" onClick={() => setQuery("")} aria-label={t("app:search.clear") ?? undefined}>
            <CloseIcon fontSize="inherit" />
          </IconButton>
        )}
      </Paper>

      <Popover
        open={dropdownOpen}
        anchorEl={anchorRef.current}
        onClose={closeDropdown}
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: anchorWidth, mt: 0, maxHeight: 480, overflow: "auto" } } }}
      >
        {loading && (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={20} />
          </Stack>
        )}
        {!loading && error && (
          <Typography variant="body2" color="error" sx={{ p: 2 }}>{error}</Typography>
        )}
        {!loading && !error && result && !hasResults && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {t("app:search.noResults", { query: trimmedQuery })}
          </Typography>
        )}
        {!loading && !error && result && hasResults && (
          <Stack divider={<Divider />}>
            {result.models.length > 0 && (
              <Box sx={{ py: 0.5 }}>
                <Typography variant="caption" fontWeight={700} sx={{ display: "block", px: 2, pt: 1, pb: 0.5, color: "text.secondary" }}>
                  {t("app:search.sectionModels")}
                </Typography>
                <List disablePadding>
                  {result.models.map((print) => (
                    <ListItemButton key={print.id} onClick={() => goTo(`/models/${print.id}`)}>
                      <ListItemAvatar sx={{ minWidth: 44 }}>
                        <Avatar
                          variant="rounded"
                          src={print.thumb_url ? printsApi.fileUrl(print.thumb_url) : undefined}
                          sx={{ width: 36, height: 36, bgcolor: "action.hover" }}
                        >
                          <ViewInArIcon fontSize="small" sx={{ color: "text.disabled" }} />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={print.title || print.name}
                        primaryTypographyProps={{ noWrap: true }}
                        secondary={print.category_name || undefined}
                        secondaryTypographyProps={{ noWrap: true }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}
            {result.collections.length > 0 && (
              <Box sx={{ py: 0.5 }}>
                <Typography variant="caption" fontWeight={700} sx={{ display: "block", px: 2, pt: 1, pb: 0.5, color: "text.secondary" }}>
                  {t("app:search.sectionCollections")}
                </Typography>
                <List disablePadding>
                  {result.collections.map((collection) => (
                    <ListItemButton key={collection.id} onClick={() => goTo(`/models/collections/${collection.id}`)}>
                      <ListItemAvatar sx={{ minWidth: 44 }}>
                        <Avatar variant="rounded" sx={{ width: 36, height: 36, bgcolor: "action.hover" }}>
                          <CollectionsIcon fontSize="small" sx={{ color: "text.disabled" }} />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={collection.name}
                        primaryTypographyProps={{ noWrap: true }}
                        secondary={t("app:search.modelCount", { count: collection.item_count })}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}
            {result.tags.length > 0 && (
              <Box sx={{ py: 0.5 }}>
                <Typography variant="caption" fontWeight={700} sx={{ display: "block", px: 2, pt: 1, pb: 0.5, color: "text.secondary" }}>
                  {t("app:search.sectionTags")}
                </Typography>
                <List disablePadding>
                  {result.tags.map((tagResult) => (
                    <ListItemButton
                      key={tagResult.tag}
                      onClick={() => goTo(`/models/tags/${encodeURIComponent(tagResult.tag)}`)}
                    >
                      <ListItemAvatar sx={{ minWidth: 44 }}>
                        <Avatar variant="rounded" sx={{ width: 36, height: 36, bgcolor: "action.hover" }}>
                          <LocalOfferIcon fontSize="small" sx={{ color: "text.disabled" }} />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={tagResult.tag}
                        primaryTypographyProps={{ noWrap: true }}
                        secondary={t("app:search.modelCount", { count: tagResult.count })}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}
          </Stack>
        )}
      </Popover>
    </Box>
  );
}
