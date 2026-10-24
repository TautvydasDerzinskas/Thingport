import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Portal from "@mui/material/Portal";
import ButtonBase from "@mui/material/ButtonBase";
import InputBase from "@mui/material/InputBase";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import type { Theme } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CollectionsIcon from "@mui/icons-material/Collections";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import LinkIcon from "@mui/icons-material/Link";
import TranslateIcon from "@mui/icons-material/Translate";
import PaletteIcon from "@mui/icons-material/Palette";
import SettingsIcon from "@mui/icons-material/Settings";
import HubIcon from "@mui/icons-material/Hub";
import LayersIcon from "@mui/icons-material/Layers";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import DownloadIcon from "@mui/icons-material/Download";
import PersonIcon from "@mui/icons-material/Person";
import WebAssetIcon from "@mui/icons-material/WebAsset";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import BoltIcon from "@mui/icons-material/Bolt";
import CableIcon from "@mui/icons-material/Cable";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import HistoryIcon from "@mui/icons-material/History";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PeopleIcon from "@mui/icons-material/People";
import PublicIcon from "@mui/icons-material/Public";
import QueueIcon from "@mui/icons-material/Queue";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import { UnauthorizedError } from "../../../api/client";
import { type SearchResult, searchApi } from "../../../api/search";
import { printsApi } from "../../../api/prints";
import { IMPORT_PROVIDER_INFO } from "../../../constants/importProviders";
import { SUPPORTED_LANGUAGES } from "../../../constants/languages";
import { detectImportProvider } from "../../../utils/importLinkDetection";
import type { ThemeSelection } from "../../../constants/settingsOptions";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { veilColor, VEIL_BLUR } from "../../../theme";
import type { ConfigurationTab } from "../ConfigurationDialog";
import Keys, { chipBg, MOD_KEY, SHIFT_KEY, isMac } from "./Keys";
import { bangArgument, bangText, isBangQuery, matchBang, type Command } from "./commands";
import { bestScore, minScoreFor } from "./match";
import { matchSystemCollections } from "./systemCollections";
import { matchPages, pagesFor, SEARCH_PAGES, type PageId, type SearchPage } from "./pages";
import { addRecent, readRecents, RECENTS_SHOWN, type RecentEntry, type RecentKind } from "./recents";
import { ListRowSkeletons } from "../../ListSkeleton";
import { PROVIDER_IDS } from "../../../providers/_generated";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const MAX_MATCHED_COMMANDS = 3;
const LIST_ID = "global-search-list";
const BAR_RADIUS = 18;
const PANEL_RADIUS = 14;
const SHORTCUT = `${MOD_KEY} S`;
const ACTIONS_ID = "global-search-actions";
// Clear of the footer, and of the panel's top edge when the list is short.
const ACTIONS_GAP = 6;
const COPIED_MS = 1500;
/** Where "see all results" leads; it reads `?q=` itself. */
const RESULTS_PATH = "/search-results";

type Props = {
  onUnauthorized?: () => void;
  theme: ThemeSelection;
  onThemeChange: (theme: ThemeSelection) => void;
  onLogout: () => void;
  /** Opens the import dialog, or with a link imports it (see AddMenuHandle). */
  onImport: (link?: string) => void;
  onOpenConfiguration: (tab: ConfigurationTab) => void;
  /** Also finds Administration's pages. */
  isAdmin: boolean;
  /** What opens it besides ⌘S: a button in place, as in the top bar, or one in the page's corner, for a page without
   *  the top bar, like the dashboard's homepage view. */
  trigger?: "button" | "corner";
};

type Item = {
  key: string;
  title: string;
  subtitle?: string;
  accessory: string;
  icon: ReactNode;
  thumbUrl?: string | null;
  actionLabel: string;
  run: () => void;
  /** Where it leads, for the actions that open it in a new tab or copy its link. */
  path?: string;
};

type ItemAction = { key: string; label: string; keys?: string; run: () => void };

type Section = { id: string; label: string; items: Item[] };

/** `subtitle` replaces the "!bang arg" shown by default. */
type PaletteCommand = Command & { icon: ReactNode; subtitle?: string; run: () => void };

const KIND_ICONS: Record<RecentKind, ReactNode> = {
  model: <ViewInArIcon />,
  collection: <CollectionsIcon />,
  tag: <LocalOfferIcon />,
  page: <WebAssetIcon />,
};

const PAGE_ICONS: Record<PageId, ReactNode> = {
  dashboard: <SpaceDashboardIcon />,
  models: <ViewInArIcon />,
  collections: <CollectionsIcon />,
  tags: <LocalOfferIcon />,
  downloads: <DownloadIcon />,
  myModels: <ViewInArIcon />,
  profile: <PersonIcon />,
  // As in Administration's own menu.
  admin: <AdminPanelSettingsIcon />,
  adminProviders: <PublicIcon />,
  adminStorage: <FolderOutlinedIcon />,
  adminAuth: <LockOutlinedIcon />,
  adminRendering: <ViewInArIcon />,
  adminAi: <AutoAwesomeIcon />,
  adminUsers: <PeopleIcon />,
  adminQueue: <QueueIcon />,
  adminLogs: <HistoryIcon />,
  adminTriggers: <BoltIcon />,
  adminConnections: <CableIcon />,
  adminCaptcha: <VerifiedUserIcon />,
};

function pageFor(entry: RecentEntry, pages: SearchPage[] = SEARCH_PAGES): SearchPage | undefined {
  return entry.kind === "page" ? pages.find((page) => page.path === entry.path) : undefined;
}

// "auto" also matches "system".
const THEMES: { theme: ThemeSelection; alias?: string; keywords: string[]; icon: ReactNode }[] = [
  { theme: "dark", keywords: ["dark", "dark mode", "night"], icon: <DarkModeOutlinedIcon /> },
  { theme: "light", keywords: ["light", "light mode", "day"], icon: <LightModeOutlinedIcon /> },
  { theme: "system", alias: "auto", keywords: ["system", "auto", "dynamic"], icon: <SettingsBrightnessOutlinedIcon /> },
];

const dimIn = keyframes`from { opacity: 0; }`;
const panelIn = keyframes`from { opacity: 0; transform: translateY(-4px); }`;
const spotlightIn = keyframes`from { opacity: 0; transform: translateY(-8px) scale(0.98); }`;

const selectedRowBg = (theme: Theme) =>
  theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";

/**
 * Command palette, opened over the middle of the screen: it dims the page and lists recents and commands; typing
 * searches models, collections and tags (ranked server-side, searchService.ts), pages and commands.
 */
export default function GlobalSearch({
  onUnauthorized,
  theme,
  onThemeChange,
  onLogout,
  onImport,
  onOpenConfiguration,
  isAdmin,
  trigger = "button",
}: Props) {
  const { t, i18n } = useTranslation(["app", "common", "models"]);
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A page that no longer exists is dropped.
  const [recents, setRecents] = useState<RecentEntry[]>(() =>
    readRecents().filter((entry) => entry.kind !== "page" || pageFor(entry)),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Until the user arrows away, the selection tracks the top row, so results that arrive late take it.
  const userMovedRef = useRef(false);
  // Where focus was before the search took it; Escape hands it back, as a dialog does.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // The corner button is gone while open, so a click on it may not have left focus anywhere worth returning to.
  const fromCornerRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Called before opening: the input is hidden while closed, so its onFocus can't see where focus came from.
  const rememberFocus = (fromCorner = false) => {
    fromCornerRef.current = fromCorner;
    const from = document.activeElement;
    if (from instanceof HTMLElement && !containerRef.current?.contains(from)) returnFocusRef.current = from;
  };
  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const trimmedQuery = query.trim();

  // Clear the query on route change, but not on same-page changes like search params.
  useEffect(() => {
    setQuery("");
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // `?q=` on any page opens the search with that query, for links from elsewhere (a dashboard's
  // "More in Thingport"). The parameter is dropped straight away so a reload doesn't reopen it.
  // The results page keeps it: there it's the page's own query.
  useEffect(() => {
    if (location.pathname === RESULTS_PATH) return;
    const params = new URLSearchParams(location.search);
    const linked = params.get("q");
    if (linked === null) return;
    params.delete("q");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace: true },
    );
    if (!linked.trim()) return;
    returnFocusRef.current = null;
    fromCornerRef.current = false;
    setQuery(linked);
    userMovedRef.current = false;
    setOpen(true);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Locks page scroll while open, padding for the scrollbar so the content doesn't shift.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
    };
  }, [open]);

  // ⌘S / Ctrl+S from anywhere, over the browser's "save page". (Windows keeps Win+S for itself.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      rememberFocus();
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The box isn't on screen until it opens, so it can't take focus before: it does once it shows. However it closes
  // (a click outside, Tab-out), it opens empty next time.
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH || isBangQuery(debouncedQuery)) {
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const finish = () => {
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  /** Escape on an empty search: close it and give focus back to where it was, or to the page. */
  const dismiss = () => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    const toTrigger = fromCornerRef.current;
    fromCornerRef.current = false;
    finish();
    // The corner button mounts again once closed.
    if (toTrigger) setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
    else if (target?.isConnected && target !== document.body) target.focus({ preventScroll: true });
  };

  const openEntry = (entry: RecentEntry) => {
    setRecents(addRecent(entry));
    finish();
    navigate(entry.path);
  };

  const entryItem = (entry: RecentEntry, accessory: string): Item => {
    const page = pageFor(entry);
    return {
      key: entry.key,
      // A recent page takes its name afresh, so it follows a language switch.
      title: page ? t(page.labelKey) : entry.title,
      // Admin pages say where they are, since "Storage" or "Users" alone could be anywhere.
      subtitle: page?.adminOnly
        ? t(page.id === "admin" ? "app:sidebar.adminOverview" : "app:sidebar.administration")
        : entry.subtitle,
      accessory,
      icon: page ? PAGE_ICONS[page.id] : KIND_ICONS[entry.kind],
      thumbUrl: entry.thumbUrl ? printsApi.fileUrl(entry.thumbUrl) : null,
      actionLabel: t("app:search.open"),
      run: () => openEntry(entry),
      path: entry.path,
    };
  };

  const kindLabel = (kind: RecentKind) => t(`app:search.kind.${kind}`);

  const pageItem = (page: SearchPage): Item =>
    entryItem({ key: `page:${page.id}`, kind: "page", title: t(page.labelKey), path: page.path }, kindLabel("page"));

  const commands: PaletteCommand[] = [
    ...THEMES.map(({ theme: target, alias, keywords, icon }) => ({
      id: `theme-${target}`,
      bang: "theme",
      arg: target,
      argAlias: alias,
      label: t(`app:search.commands.theme.${target}`),
      keywords,
      icon,
      run: () => onThemeChange(target),
    })),
    // Also matched by either name: "!language lith", "!language lietuvių".
    ...SUPPORTED_LANGUAGES.map(({ code, label, englishName }) => ({
      id: `language-${code}`,
      bang: "language",
      arg: code,
      argAlias: [englishName, label].join(" ").toLowerCase(),
      // Named in itself, as in the profile's picker, so it's findable from any UI language.
      label: t("app:search.commands.language", { name: label }),
      keywords: ["language", "kalba", ...`${englishName} ${label}`.toLowerCase().split(" ")],
      icon: <TranslateIcon />,
      run: () => void i18n.changeLanguage(code),
    })),
    {
      id: "configuration",
      bang: "configuration",
      label: t("app:search.commands.configuration"),
      keywords: ["configuration", "configure", "settings", "preferences", "konfigūracija", "nustatymai"],
      icon: <SettingsIcon />,
      run: () => onOpenConfiguration("appearance"),
    },
    {
      id: "appearance",
      bang: "appearance",
      label: t("app:search.commands.appearance"),
      keywords: ["appearance", "theme", "language", "author preview", "look"],
      icon: <PaletteIcon />,
      run: () => onOpenConfiguration("appearance"),
    },
    {
      id: "providers",
      bang: "providers",
      label: t("app:search.commands.providers"),
      keywords: ["providers", ...PROVIDER_IDS, "cookie"],
      icon: <HubIcon />,
      run: () => onOpenConfiguration("providers"),
    },
    {
      id: "slicer",
      bang: "slicer",
      label: t("app:search.commands.slicer"),
      keywords: ["slicer", "bambu studio", "orca", "prusaslicer", "cura"],
      icon: <LayersIcon />,
      run: () => onOpenConfiguration("slicer"),
    },
    importCommand(),
    {
      id: "logout",
      bang: "logout",
      label: t("common:logOut"),
      keywords: ["log out", "sign out", "logout"],
      icon: <LogoutIcon />,
      run: onLogout,
    },
  ];

  // "!import" opens the import dialog; "!import <link>" imports a supported link, or else opens the
  // dialog with it.
  function importCommand(): PaletteCommand {
    const link = /^!import\b/i.test(trimmedQuery) ? bangArgument(trimmedQuery) : "";
    const provider = link && !/\s/.test(link) ? detectImportProvider(link) : null;
    const base = { id: "import", bang: "import", keywords: ["import", "add", "link", "url"], icon: <LinkIcon /> };
    if (provider) {
      return {
        ...base,
        label: t("app:search.commands.importFrom", { provider: IMPORT_PROVIDER_INFO[provider].label }),
        subtitle: link,
        run: () => onImport(link),
      };
    }
    return {
      ...base,
      label: t("app:search.commands.import"),
      subtitle: link ? t("app:search.commands.importNotSupported") : "!import <link>",
      run: () => onImport(link || undefined),
    };
  }

  const commandItem = (command: PaletteCommand): Item => ({
    key: `command:${command.id}`,
    title: command.label,
    subtitle: command.subtitle ?? bangText(command),
    accessory: t("app:search.kind.command"),
    icon: command.icon,
    actionLabel: t("app:search.runCommand"),
    run: () => {
      finish();
      command.run();
    },
  });
  const commandsSection = (items: PaletteCommand[]): Section => ({
    id: "commands",
    label: t("app:search.sectionCommands"),
    items: items.map(commandItem),
  });

  const bang = isBangQuery(trimmedQuery);
  const sections: Section[] = [];
  if (bang) {
    const matched = matchBang(trimmedQuery, commands);
    if (matched.length) sections.push(commandsSection(matched));
  } else if (!trimmedQuery) {
    if (recents.length) {
      sections.push({
        id: "recent",
        label: t("app:search.sectionRecent"),
        items: recents
          // Kept, not dropped, while the viewer isn't known to be an admin yet.
          .filter((entry) => entry.kind !== "page" || pageFor(entry, pagesFor(isAdmin)))
          .slice(0, RECENTS_SHOWN)
          .map((entry) => entryItem(entry, kindLabel(entry.kind))),
      });
    }
    // Suggests whichever of light and dark isn't picked.
    const suggested = commands.find((c) => c.id === (theme === "light" ? "theme-dark" : "theme-light"));
    if (suggested) sections.push(commandsSection([suggested]));
  } else {
    // The server never finds these (see systemCollections.ts).
    const systemCollections =
      trimmedQuery.length >= MIN_QUERY_LENGTH
        ? matchSystemCollections(trimmedQuery, {
            favorites: t("models:collections.system.favorites"),
            history: t("models:collections.system.history"),
          }).map((key) =>
            entryItem(
              {
                key: `collection:${key}`,
                kind: "collection",
                title: t(`models:collections.system.${key}`),
                subtitle: t("app:search.builtInCollection"),
                path: `/models/collections/${key}`,
              },
              kindLabel("collection"),
            ),
          )
        : [];
    // Kept from the previous query while the next one loads, so the list doesn't flicker as you type.
    if (result && trimmedQuery.length >= MIN_QUERY_LENGTH) {
      const models = result.models.map((print) =>
        entryItem(
          {
            key: `model:${print.id}`,
            kind: "model",
            title: print.title || print.name,
            subtitle: print.category_name || undefined,
            thumbUrl: print.thumb_url,
            path: `/models/${print.id}`,
          },
          kindLabel("model"),
        ),
      );
      const collections = [
        ...systemCollections,
        ...result.collections.map((collection) =>
          entryItem(
            {
              key: `collection:${collection.id}`,
              kind: "collection",
              title: collection.name,
              subtitle: t("app:search.modelCount", { count: collection.item_count }),
              path: `/models/collections/${collection.id}`,
            },
            kindLabel("collection"),
          ),
        ),
      ];
      const tags = result.tags.map((tagResult) =>
        entryItem(
          {
            key: `tag:${tagResult.tag}`,
            kind: "tag",
            title: tagResult.tag,
            subtitle: t("app:search.modelCount", { count: tagResult.count }),
            path: `/models/tags/${encodeURIComponent(tagResult.tag)}`,
          },
          kindLabel("tag"),
        ),
      );
      // Kept out of recents: it's the query, not a place.
      if (result.has_more_models) {
        const path = `${RESULTS_PATH}?${new URLSearchParams({ q: trimmedQuery })}`;
        models.push({
          key: "more:models",
          title: t("app:search.seeAllModels", { query: trimmedQuery }),
          accessory: "",
          icon: <ArrowForwardIcon />,
          actionLabel: t("app:search.open"),
          run: () => {
            finish();
            navigate(path);
          },
          path,
        });
      }
      if (models.length) sections.push({ id: "models", label: t("app:search.sectionModels"), items: models });
      if (collections.length) {
        sections.push({ id: "collections", label: t("app:search.sectionCollections"), items: collections });
      }
      if (tags.length) sections.push({ id: "tags", label: t("app:search.sectionTags"), items: tags });
    } else if (systemCollections.length) {
      sections.push({ id: "collections", label: t("app:search.sectionCollections"), items: systemCollections });
    }
    const pageLabels = Object.fromEntries(SEARCH_PAGES.map((page) => [page.id, t(page.labelKey)])) as Record<
      PageId,
      string
    >;
    const pages = matchPages(trimmedQuery, pageLabels, isAdmin).map(pageItem);
    if (pages.length) sections.push({ id: "pages", label: t("app:search.sectionPages"), items: pages });
    const matched = commands
      .map((command) => ({ command, score: bestScore(trimmedQuery, command.label, command.keywords) }))
      .filter((c) => c.score >= minScoreFor(trimmedQuery))
      .toSorted((a, b) => b.score - a.score)
      .slice(0, MAX_MATCHED_COMMANDS)
      .map((c) => c.command);
    if (matched.length) sections.push(commandsSection(matched));
  }

  const flatItems = sections.flatMap((section) => section.items);
  const keysSignature = flatItems.map((item) => item.key).join("\n");
  const selectedIndex = flatItems.findIndex((item) => item.key === selectedKey);
  const selected = selectedIndex >= 0 ? flatItems[selectedIndex] : null;

  // ⌘K: what else the selected row can do, in a panel over the list's corner.
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [actionsRoom, setActionsRoom] = useState<{ bottom: number; minHeight: number } | null>(null);

  const itemActions = (item: Item): ItemAction[] => {
    const { path } = item;
    const first = { key: "run", label: item.actionLabel, keys: "↵", run: item.run };
    if (!path) return [first];
    return [
      first,
      {
        key: "newTab",
        label: t("app:search.openInNewTab"),
        keys: `${MOD_KEY} ↵`,
        run: () => {
          window.open(path, "_blank", "noopener");
          finish();
        },
      },
      {
        key: "copyLink",
        label: t("app:search.copyLink"),
        keys: `${MOD_KEY} ${SHIFT_KEY} C`,
        // The clipboard API only exists on HTTPS or localhost; elsewhere this quietly does nothing.
        run: async () => {
          setActionsOpen(false);
          try {
            await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
            setCopied(true);
          } catch {
            // Nothing to fall back to: the link isn't on the page to select.
          }
        },
      },
    ];
  };
  const selectedActions = selected ? itemActions(selected) : [];

  // A different row, query or closing puts the panel away.
  useEffect(() => setActionsOpen(false), [selectedKey, query, open]);
  useEffect(() => {
    if (actionsOpen) setActionIndex(0);
  }, [actionsOpen]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // The panel floats over the list, so a short list (one result) would cut it off at the top: the results grow to
  // fit it while it's open.
  useLayoutEffect(() => {
    const actions = actionsRef.current;
    const footer = footerRef.current;
    if (!actionsOpen || !actions || !footer) {
      setActionsRoom(null);
      return;
    }
    const bottom = footer.offsetHeight + ACTIONS_GAP;
    setActionsRoom({ bottom, minHeight: bottom + actions.offsetHeight + ACTIONS_GAP * 2 });
  }, [actionsOpen, selectedKey]);

  const runAction = (action: ItemAction | undefined) => {
    setActionsOpen(false);
    action?.run();
  };

  useEffect(() => {
    userMovedRef.current = false;
  }, [query]);

  useEffect(() => {
    const keys = keysSignature ? keysSignature.split("\n") : [];
    setSelectedKey((current) =>
      !userMovedRef.current || !current || !keys.includes(current) ? (keys[0] ?? null) : current,
    );
  }, [keysSignature, query]);

  useEffect(() => {
    const row = selectedIndex >= 0 ? document.getElementById(`${LIST_ID}-${selectedIndex}`) : null;
    row?.scrollIntoView({ block: "nearest" });
    // A section's first row brings its heading too, which would otherwise stay scrolled off above it.
    const above = row?.previousElementSibling;
    if (above && above.getAttribute("role") !== "option") above.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const moveSelection = (delta: number) => {
    if (!flatItems.length) return;
    const next = (selectedIndex + delta + flatItems.length) % flatItems.length;
    setSelectedKey(flatItems[next].key);
    userMovedRef.current = true;
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && !e.shiftKey && key === "k") {
      e.preventDefault();
      if (selectedActions.length > 1) setActionsOpen((current) => !current);
      return;
    }
    if (mod && e.shiftKey && key === "c") {
      const copy = selectedActions.find((action) => action.key === "copyLink");
      if (!copy) return;
      e.preventDefault();
      runAction(copy);
      return;
    }
    if (actionsOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const count = selectedActions.length;
      setActionIndex((index) => (index + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      if (!selected) return;
      e.preventDefault();
      if (actionsOpen) runAction(selectedActions[actionIndex]);
      // ⌘↵ opens it in a new tab, as a ⌘-click on a link does.
      else if (mod) runAction(selectedActions.find((action) => action.key === "newTab") ?? selectedActions[0]);
      else selected.run();
    }
  };

  // Escape clears the query, then closes. Handled on the window: keyboard extensions (e.g. Vimium)
  // blur text fields on Escape, which would leave the next Escape unheard.
  const escapeRef = useRef<() => void>(() => {});
  escapeRef.current = () => {
    if (!actionsOpen && !query) {
      dismiss();
      return;
    }
    if (actionsOpen) setActionsOpen(false);
    else setQuery("");
    // After this event, so after any extension's blur.
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      escapeRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  // The panel stays open while focused; with no rows it says why.
  const searchPending = trimmedQuery !== debouncedQuery || loading;
  let emptyText: string | null = null;
  let searching = false;
  if (bang) {
    if (!flatItems.length) emptyText = t("app:search.noCommand");
  } else if (error) {
    emptyText = error;
  } else if (!flatItems.length && trimmedQuery) {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) emptyText = t("app:search.keepTyping");
    else if (searchPending) searching = true;
    else emptyText = t("app:search.noResults", { query: trimmedQuery });
  }
  const panelOpen = open;

  return (
    <>
      {(trigger === "button" || !open) && (
        <Tooltip title={t("app:search.openSearch")}>
          <ButtonBase
            ref={triggerRef}
            onClick={() => {
              rememberFocus(trigger === "corner");
              setOpen(true);
            }}
            aria-label={t("app:search.openSearch") ?? undefined}
            aria-keyshortcuts={isMac ? "Meta+S" : "Control+S"}
            sx={(muiTheme) => ({
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              px: 1.25,
              py: 0.5,
              borderRadius: 999,
              border: 1,
              borderColor: "divider",
              color: "text.secondary",
              transition: "background-color 150ms ease, color 150ms ease, opacity 150ms ease",
              "&:hover": { bgcolor: chipBg(muiTheme), color: "text.primary" },
              "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
              ...(trigger === "corner" && {
                position: "fixed",
                right: 20,
                bottom: 20,
                zIndex: muiTheme.zIndex.speedDial,
                px: 1.5,
                py: 0.75,
                bgcolor: "background.paper",
                boxShadow: 2,
                opacity: 0.75,
                // Stays opaque over the page.
                "&:hover": { color: "text.primary" },
                "&:hover, &.Mui-focusVisible": { opacity: 1 },
              }),
            })}
          >
            <SearchIcon fontSize="small" />
            <Box
              component="span"
              sx={{ display: trigger === "button" ? { xs: "none", sm: "inline-flex" } : "inline-flex" }}
            >
              <Keys keys={SHORTCUT} />
            </Box>
          </ButtonBase>
        </Tooltip>
      )}
      {/* In a portal, so no stacking context of where the trigger sits (the sticky top bar) keeps it under the page. */}
      <Portal>
        {open && (
          <Box
            aria-hidden
            onMouseDown={() => setOpen(false)}
            sx={{
              position: "fixed",
              inset: 0,
              zIndex: (muiTheme) => muiTheme.zIndex.modal - 1,
              bgcolor: (muiTheme) => veilColor(muiTheme.palette.mode),
              backdropFilter: VEIL_BLUR,
              animation: `${dimIn} 180ms ease-out`,
            }}
          />
        )}
        <Box
          ref={containerRef}
          // Closes when keyboard focus leaves the palette (Tab-out). A click outside lands on the dim.
          onBlur={(e) => {
            if (e.relatedTarget && !containerRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
          }}
          sx={{
            display: open ? "block" : "none",
            position: "fixed",
            top: "14vh",
            left: 0,
            right: 0,
            mx: "auto",
            width: "min(760px, calc(100vw - 32px))",
            zIndex: (muiTheme) => muiTheme.zIndex.modal,
            // One shadow round the box and the panel under it, so neither shades the other and they read as one.
            borderRadius: panelOpen ? `${BAR_RADIUS}px ${BAR_RADIUS}px ${PANEL_RADIUS}px ${PANEL_RADIUS}px` : 999,
            boxShadow: 12,
            animation: `${spotlightIn} 180ms ease-out`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          <Paper
            variant="outlined"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              px: 2.25,
              py: 1.25,
              borderRadius: panelOpen ? `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0` : 999,
              bgcolor: "background.paper",
            }}
          >
            <SearchIcon sx={{ color: "text.disabled" }} />
            <InputBase
              fullWidth
              size="small"
              inputRef={inputRef}
              placeholder={t("app:search.placeholder") ?? undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              inputProps={{
                role: "combobox",
                "aria-expanded": panelOpen,
                "aria-controls": LIST_ID,
                "aria-autocomplete": "list",
                "aria-activedescendant": actionsOpen
                  ? `${ACTIONS_ID}-${actionIndex}`
                  : panelOpen && selectedIndex >= 0
                    ? `${LIST_ID}-${selectedIndex}`
                    : undefined,
                autoComplete: "off",
                spellCheck: false,
              }}
              sx={{ fontSize: 20 }}
            />
            {loading && trimmedQuery && <CircularProgress size={14} sx={{ flexShrink: 0 }} />}
            {query ? (
              <IconButton
                size="small"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label={t("app:search.clear") ?? undefined}
                // Taller than the keycaps it replaces; keeps the bar from jumping on the first keystroke.
                sx={{ my: -0.5 }}
              >
                <CloseIcon fontSize="inherit" />
              </IconButton>
            ) : (
              <Box sx={{ display: { xs: "none", md: "inline-flex" }, pr: 0.25 }}>
                <Keys keys={SHORTCUT} />
              </Box>
            )}
          </Paper>

          {panelOpen && (
            <Box
              // Keeps focus in the input when a row or the footer is clicked.
              onMouseDown={(e) => e.preventDefault()}
              sx={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                maxHeight: "min(560px, calc(86vh - 96px))",
                minHeight: actionsRoom?.minHeight,
                bgcolor: "background.paper",
                border: 1,
                borderTop: 0,
                borderColor: "divider",
                borderRadius: `0 0 ${PANEL_RADIUS}px ${PANEL_RADIUS}px`,
                overflow: "hidden",
                animation: `${panelIn} 140ms ease-out`,
              }}
            >
              <Box
                id={LIST_ID}
                // No native element fits a combobox popup of rich rows.
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                role="listbox"
                sx={{
                  flex: "1 1 auto",
                  minHeight: 0,
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                  px: 0.75,
                  pb: 0.75,
                }}
              >
                {sections.map((section) => (
                  <Box key={section.id}>
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        px: 1.25,
                        pt: 1.25,
                        pb: 0.5,
                        fontSize: "0.65rem",
                        fontWeight: 600,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: "text.secondary",
                      }}
                    >
                      {section.label}
                    </Typography>
                    {section.items.map((item) => {
                      const index = flatItems.indexOf(item);
                      return (
                        <SearchRow
                          key={item.key}
                          id={`${LIST_ID}-${index}`}
                          item={item}
                          selected={index === selectedIndex}
                          onHover={() => {
                            if (index === selectedIndex) return;
                            setSelectedKey(item.key);
                            userMovedRef.current = true;
                          }}
                        />
                      );
                    })}
                  </Box>
                ))}
                {searching && (
                  <Box
                    component="output"
                    sx={{ display: "block", py: 1 }}
                    aria-label={t("app:search.searching") ?? undefined}
                  >
                    <ListRowSkeletons count={3} lead="rounded" leadSize={20} />
                  </Box>
                )}
                {emptyText && (
                  <Typography
                    variant="body2"
                    color={!bang && error ? "error" : "text.secondary"}
                    sx={{ px: 1.25, py: 1.5 }}
                  >
                    {emptyText}
                  </Typography>
                )}
              </Box>
              <Box
                ref={footerRef}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  px: 1.5,
                  py: 0.75,
                  mt: "auto",
                  borderTop: 1,
                  borderColor: "divider",
                  color: "text.secondary",
                  fontSize: 12,
                }}
              >
                <Box component="output" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, mr: "auto" }}>
                  {copied ? (
                    <>
                      <CheckIcon sx={{ fontSize: 14, color: "success.main" }} /> {t("app:search.linkCopied")}
                    </>
                  ) : (
                    <>
                      <Keys keys="↑ ↓" /> {t("app:search.toMove")}
                    </>
                  )}
                </Box>
                {selected && (
                  <FooterButton onClick={() => runAction(selectedActions[0])}>
                    {selected.actionLabel} <Keys keys="↵" />
                  </FooterButton>
                )}
                {selectedActions.length > 1 && (
                  <>
                    <Box component="span" sx={{ width: "1px", height: 14, bgcolor: "divider" }} />
                    <FooterButton aria-expanded={actionsOpen} onClick={() => setActionsOpen((current) => !current)}>
                      {t("app:search.actions")} <Keys keys={`${MOD_KEY} K`} />
                    </FooterButton>
                  </>
                )}
              </Box>
              {actionsOpen && selected && (
                <Box
                  ref={actionsRef}
                  id={ACTIONS_ID}
                  role="menu"
                  aria-label={t("app:search.actionsFor", { title: selected.title }) ?? undefined}
                  sx={(muiTheme) => ({
                    position: "absolute",
                    right: 8,
                    bottom: actionsRoom?.bottom ?? 40,
                    zIndex: 1,
                    width: "min(280px, calc(100% - 16px))",
                    p: 0.75,
                    borderRadius: "12px",
                    border: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    boxShadow: muiTheme.shadows[8],
                    animation: `${panelIn} 120ms ease-out`,
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                  })}
                >
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      display: "block",
                      px: 1,
                      py: 0.75,
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "text.secondary",
                    }}
                  >
                    {selected.title}
                  </Typography>
                  {selectedActions.map((action, index) => (
                    <Box
                      key={action.key}
                      id={`${ACTIONS_ID}-${index}`}
                      component="button"
                      type="button"
                      role="menuitem"
                      onPointerMove={() => setActionIndex(index)}
                      onClick={() => runAction(action)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 1,
                        width: "100%",
                        minHeight: 34,
                        px: 1,
                        py: 0.75,
                        border: 0,
                        borderRadius: "8px",
                        bgcolor: index === actionIndex ? selectedRowBg : "transparent",
                        color: (muiTheme) => muiTheme.thingport.headingText,
                        font: "inherit",
                        fontSize: 13,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span>{action.label}</span>
                      {action.keys && <Keys keys={action.keys} />}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Portal>
    </>
  );
}

function FooterButton({
  children,
  onClick,
  ...aria
}: {
  children: ReactNode;
  onClick: () => void;
  "aria-expanded"?: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      {...aria}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        border: 0,
        p: 0,
        bgcolor: "transparent",
        color: "inherit",
        font: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </Box>
  );
}

function SearchRow({
  id,
  item,
  selected,
  onHover,
}: {
  id: string;
  item: Item;
  selected: boolean;
  onHover: () => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <Box
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="option"
      aria-selected={selected}
      onPointerMove={onHover}
      onClick={item.run}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        minHeight: 40,
        px: 1.25,
        py: 0.75,
        borderRadius: "9px",
        cursor: "pointer",
        bgcolor: selected ? selectedRowBg : "transparent",
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: 28,
          height: 28,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderRadius: "7px",
          border: 1,
          borderColor: "divider",
          bgcolor: chipBg,
          color: "text.secondary",
          "& .MuiSvgIcon-root": { fontSize: 16 },
        }}
      >
        {item.icon}
        {item.thumbUrl && !thumbFailed && (
          <Box
            component="img"
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.25, minWidth: 0, flex: "1 1 auto" }}>
        <Typography
          variant="body2"
          noWrap
          // A long subtitle gives way to the title.
          sx={{ flexShrink: 0, maxWidth: "75%", color: (theme) => theme.thingport.headingText }}
        >
          {item.title}
        </Typography>
        {item.subtitle && (
          <Typography variant="caption" noWrap color="text.secondary" sx={{ flexShrink: 2, minWidth: 0 }}>
            {item.subtitle}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, display: { xs: "none", sm: "block" } }}>
        {item.accessory}
      </Typography>
    </Box>
  );
}
