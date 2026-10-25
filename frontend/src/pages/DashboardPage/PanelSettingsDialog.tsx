import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DashboardTemplate, WeatherLocation, WidgetInstanceId } from "../../api/settings";
import Segmented from "../../components/controls/Segmented";
import {
  allowed,
  cleanLink,
  isWebUrl,
  resolveSettings,
  widgetById,
  type LauncherLink,
  type ResolvedSettings,
  labelOf,
} from "./widgets";
import { LauncherIcon, type LauncherIconStyle } from "./LauncherCard";
import IconPicker from "../../components/IconPicker/IconPicker";
import Checkbox from "@mui/material/Checkbox";
import ProviderBadge from "../../components/ProviderBadge";
import { printProviderInfo } from "../../constants/importProviders";

type Props = {
  /** The panel's widgets that have options; null while closed. */
  widgets: WidgetInstanceId[] | null;
  template: DashboardTemplate;
  /** Admin-only options are left out for everyone else. */
  isAdmin: boolean;
  onChange: (id: WidgetInstanceId, values: ResolvedSettings) => void;
  onClose: () => void;
};

/** A panel's options. Each applies straight away, so the panel behind updates as the user goes. */
export default function PanelSettingsDialog({ widgets, template, isAdmin, onChange, onClose }: Props) {
  const { t } = useTranslation("app");
  // Each copy of a widget has its own options, so they're kept by instance.
  const shown = (widgets ?? []).flatMap((instance) => {
    const widget = widgetById(instance);
    return widget ? [{ instance, widget }] : [];
  });
  const changed = shown.some(({ instance }) => template.settings?.[instance]);
  const title =
    shown.length === 1
      ? t("dashboard.settings.title", { name: labelOf(t, shown[0].widget) })
      : t("dashboard.settings.titlePanel");

  return (
    <Dialog open={widgets !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          {shown.map(({ instance, widget }) => {
            const values = resolveSettings(widget, template.settings?.[instance]);
            const set = (key: string, value: ResolvedSettings[string]) =>
              onChange(instance, { ...values, [key]: value });
            return (
              <Stack key={instance} spacing={1.5}>
                {shown.length > 1 && (
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "primary.main" }}>
                    {widget.icon}
                    <Typography variant="subtitle2" color="text.primary">
                      {labelOf(t, widget)}
                    </Typography>
                  </Stack>
                )}
                {widget
                  .settings!.filter((setting) => allowed(setting, isAdmin))
                  .map((setting) =>
                    setting.kind === "pick" ? (
                      <ProviderPicker
                        key={setting.key}
                        label={labelOf(t, setting)}
                        options={setting.options}
                        picked={values[setting.key] as string[]}
                        onChange={(picked) => set(setting.key, picked)}
                      />
                    ) : setting.kind === "links" ? (
                      <LinksEditor
                        key={setting.key}
                        label={labelOf(t, setting)}
                        max={setting.max}
                        links={values[setting.key] as LauncherLink[]}
                        iconStyle={(values.iconStyle as LauncherIconStyle) ?? "colored"}
                        onChange={(links) => set(setting.key, links)}
                      />
                    ) : setting.kind === "urls" ? (
                      <UrlListEditor
                        key={setting.key}
                        label={labelOf(t, setting)}
                        placeholder={t(setting.placeholderKey)}
                        max={setting.max}
                        urls={values[setting.key] as string[]}
                        onChange={(urls) => set(setting.key, urls)}
                      />
                    ) : (
                      <Box
                        key={setting.key}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 2,
                          minHeight: 38,
                        }}
                      >
                        <Typography variant="body2" id={`${instance}-${setting.key}`}>
                          {labelOf(t, setting)}
                        </Typography>
                        {setting.kind === "choice" ? (
                          <Segmented
                            label={labelOf(t, setting)}
                            value={values[setting.key] as string}
                            options={setting.options.map((option) => ({
                              value: option.value,
                              label: option.label ?? t(option.labelKey ?? ""),
                            }))}
                            onChange={(value) => set(setting.key, value)}
                          />
                        ) : setting.kind === "text" ? (
                          <TextSetting
                            label={labelOf(t, setting)}
                            value={values[setting.key] as string}
                            placeholder={
                              setting.placeholder ?? (setting.placeholderKey ? t(setting.placeholderKey) : undefined)
                            }
                            maxLength={setting.maxLength}
                            secret={setting.secret}
                            numeric={setting.numeric}
                            onCommit={(value) => set(setting.key, value)}
                          />
                        ) : setting.kind === "place" ? (
                          <PlaceValue
                            place={values[setting.key] as WeatherLocation | null}
                            onClear={() => set(setting.key, null)}
                          />
                        ) : (
                          <Switch
                            checked={values[setting.key] === true}
                            onChange={(event) => set(setting.key, event.target.checked)}
                            slotProps={{ input: { "aria-labelledby": `${instance}-${setting.key}` } }}
                          />
                        )}
                      </Box>
                    ),
                  )}
              </Stack>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3, pb: 2 }}>
        <Button
          color="inherit"
          disabled={!changed}
          onClick={() =>
            shown.forEach(({ instance, widget }) => onChange(instance, resolveSettings(widget, undefined)))
          }
        >
          {t("dashboard.settings.reset")}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t("dashboard.settings.done")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A list of addresses, e.g. feeds or services to watch: each removable, and a field to add another. */
function UrlListEditor({
  label,
  placeholder,
  max,
  urls,
  onChange,
}: {
  label: string;
  placeholder: string;
  max: number;
  urls: string[];
  onChange: (urls: string[]) => void;
}) {
  const { t } = useTranslation("app");
  const [draft, setDraft] = useState("");
  const value = draft.trim();
  // An address without a scheme gets https, as a browser's address bar would.
  const candidate = value && !/^[a-z][a-z\d+.-]*:/i.test(value) ? `https://${value}` : value;
  const invalid = value !== "" && !isWebUrl(candidate);
  const duplicate = urls.includes(candidate);
  const full = urls.length >= max;

  const add = () => {
    if (!value || invalid || duplicate || full) return;
    onChange([...urls, candidate]);
    setDraft("");
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {label}
      </Typography>
      {urls.length > 0 && (
        <List dense disablePadding sx={{ mb: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
          {urls.map((url) => (
            <ListItem
              key={url}
              sx={{ pr: 6 }}
              secondaryAction={
                <Tooltip title={t("dashboard.settings.removeUrl")}>
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label={`${t("dashboard.settings.removeUrl")}: ${url}`}
                    onClick={() => onChange(urls.filter((other) => other !== url))}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <Typography variant="body2" noWrap title={url}>
                {url}
              </Typography>
            </ListItem>
          ))}
        </List>
      )}
      <Box
        component="form"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          add();
        }}
        sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}
      >
        <TextField
          size="small"
          fullWidth
          value={draft}
          disabled={full}
          placeholder={full ? t("dashboard.settings.urlsFull", { max }) : placeholder}
          onChange={(event) => setDraft(event.target.value)}
          error={invalid || duplicate}
          helperText={
            invalid ? t("dashboard.settings.urlInvalid") : duplicate ? t("dashboard.settings.urlDuplicate") : undefined
          }
          slotProps={{ htmlInput: { "aria-label": label, inputMode: "url" } }}
        />
        <Button
          type="submit"
          variant="outlined"
          disabled={!value || invalid || duplicate || full}
          sx={{ flexShrink: 0 }}
        >
          {t("dashboard.settings.addUrl")}
        </Button>
      </Box>
    </Box>
  );
}

/** Adds `https://` to an address typed without a scheme, as a browser's address bar would. */
const withScheme = (value: string) => (value && !/^[a-z][a-z\d+.-]*:/i.test(value) ? `https://${value}` : value);

/** The launcher's items: dragged into order, edited or removed in the list, and added with the form below it. */
function LinksEditor({
  label,
  max,
  links,
  iconStyle,
  onChange,
}: {
  label: string;
  max: number;
  links: LauncherLink[];
  iconStyle: LauncherIconStyle;
  onChange: (links: LauncherLink[]) => void;
}) {
  const { t } = useTranslation("app");
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = links.map((_, index) => String(index));
  const fullUrl = withScheme(url.trim());
  const urlInvalid = url.trim() !== "" && !isWebUrl(fullUrl);
  const full = links.length >= max && editing === null;
  const draft = cleanLink({ name, url: fullUrl, icon });

  const reset = () => {
    setEditing(null);
    setName("");
    setUrl("");
    setIcon("");
  };
  const save = () => {
    if (!draft || urlInvalid || full) return;
    onChange(editing === null ? [...links, draft] : links.map((link, index) => (index === editing ? draft : link)));
    reset();
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange(arrayMove(links, Number(active.id), Number(over.id)));
    reset();
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {label}
      </Typography>
      {links.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <List dense disablePadding sx={{ mb: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
              {links.map((link, index) => (
                <SortableLink
                  key={ids[index]}
                  id={ids[index]}
                  link={link}
                  iconStyle={iconStyle}
                  editing={editing === index}
                  onEdit={() => {
                    setEditing(index);
                    setName(link.name);
                    setUrl(link.url);
                    setIcon(link.icon);
                  }}
                  onRemove={() => {
                    onChange(links.filter((_, other) => other !== index));
                    reset();
                  }}
                />
              ))}
            </List>
          </SortableContext>
        </DndContext>
      )}
      <Box
        component="form"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          save();
        }}
        sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1 }}
      >
        <TextField
          size="small"
          label={t("dashboard.settings.linkName")}
          value={name}
          disabled={full}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 60 } }}
        />
        <TextField
          size="small"
          label={t("dashboard.settings.linkUrl")}
          placeholder="https://"
          value={url}
          disabled={full}
          onChange={(event) => setUrl(event.target.value)}
          error={urlInvalid}
          helperText={urlInvalid ? t("dashboard.settings.urlInvalid") : undefined}
          slotProps={{ htmlInput: { inputMode: "url" } }}
        />
        <Box sx={{ gridColumn: { sm: "1 / -1" } }}>
          <IconPicker
            label={t("dashboard.settings.linkIcon")}
            emptyLabel={t("dashboard.settings.linkIconSite")}
            value={icon}
            disabled={full}
            onChange={setIcon}
            preview={
              <LauncherIcon
                item={{ name, url: isWebUrl(fullUrl) ? fullUrl : "", icon }}
                iconStyle={iconStyle}
                size={32}
              />
            }
          />
        </Box>
        <Box sx={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {full ? t("dashboard.settings.linksFull", { max }) : draft ? draft.name : ""}
          </Typography>
          {editing !== null && <Button onClick={reset}>{t("dashboard.settings.cancelEdit")}</Button>}
          <Button type="submit" variant="outlined" disabled={!draft || urlInvalid || full}>
            {editing === null ? t("dashboard.settings.addUrl") : t("dashboard.settings.saveLink")}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

function SortableLink({
  id,
  link,
  iconStyle,
  editing,
  onEdit,
  onRemove,
}: {
  id: string;
  link: LauncherLink;
  iconStyle: LauncherIconStyle;
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("app");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <ListItem
      ref={setNodeRef}
      sx={{
        gap: 1,
        pl: 0.5,
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 1 : "auto",
        bgcolor: isDragging || editing ? "action.selected" : "background.paper",
      }}
    >
      <IconButton
        ref={setActivatorNodeRef}
        size="small"
        aria-label={t("dashboard.settings.reorderLink", { name: link.name })}
        sx={{ cursor: "grab", touchAction: "none" }}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <LauncherIcon item={link} iconStyle={iconStyle} size={28} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {link.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div" title={link.url}>
          {link.url}
        </Typography>
      </Box>
      <Tooltip title={t("dashboard.settings.editLink")}>
        <IconButton size="small" aria-label={`${t("dashboard.settings.editLink")}: ${link.name}`} onClick={onEdit}>
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={t("dashboard.settings.removeUrl")}>
        <IconButton size="small" aria-label={`${t("dashboard.settings.removeUrl")}: ${link.name}`} onClick={onRemove}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </ListItem>
  );
}

/** A panel's own place, chosen on the panel; clearing it goes back to the account's place. */
function PlaceValue({ place, onClear }: { place: WeatherLocation | null; onClear: () => void }) {
  const { t } = useTranslation("app");
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
      <Typography variant="body2" color={place ? "text.primary" : "text.secondary"} noWrap>
        {place ? place.name || t("dashboard.weather.yourArea") : t("dashboard.settings.placeAccount")}
      </Typography>
      {place && (
        <Button size="small" onClick={onClear} sx={{ flexShrink: 0 }}>
          {t("dashboard.settings.placeReset")}
        </Button>
      )}
    </Box>
  );
}

/**
 * Providers to show, in order: the picked ones first, dragged into the order the panel shows them (the first opens
 * with it), then the rest, ticked to add one at the end. At least one stays picked.
 */
function ProviderPicker({
  label,
  options,
  picked,
  onChange,
}: {
  label: string;
  options: readonly string[];
  picked: string[];
  onChange: (picked: string[]) => void;
}) {
  const { t } = useTranslation("app");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rest = options.filter((option) => !picked.includes(option));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange(arrayMove(picked, picked.indexOf(String(active.id)), picked.indexOf(String(over.id))));
  };
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {label}
      </Typography>
      <List dense disablePadding sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={picked} strategy={verticalListSortingStrategy}>
            {picked.map((option, index) => (
              <SortableProvider
                key={option}
                id={option}
                first={index === 0}
                // The last one can't go: a panel needs something to show.
                onRemove={picked.length > 1 ? () => onChange(picked.filter((other) => other !== option)) : undefined}
              />
            ))}
          </SortableContext>
        </DndContext>
        {rest.map((option) => (
          <ListItem key={option} sx={{ gap: 1, pl: 5.5, opacity: 0.7 }}>
            <ProviderBadge provider={option} size={24} interactive={false} sx={{ boxShadow: "none" }} />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {printProviderInfo(option).label}
            </Typography>
            <Checkbox
              size="small"
              checked={false}
              onChange={() => onChange([...picked, option])}
              slotProps={{
                input: {
                  "aria-label": t("dashboard.settings.showProvider", { name: printProviderInfo(option).label }),
                },
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

function SortableProvider({ id, first, onRemove }: { id: string; first: boolean; onRemove?: () => void }) {
  const { t } = useTranslation("app");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const name = printProviderInfo(id).label;
  return (
    <ListItem
      ref={setNodeRef}
      sx={{
        gap: 1,
        pl: 0.5,
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 1 : "auto",
        bgcolor: isDragging ? "action.selected" : "background.paper",
      }}
    >
      <IconButton
        ref={setActivatorNodeRef}
        size="small"
        aria-label={t("dashboard.settings.reorderLink", { name })}
        sx={{ cursor: "grab", touchAction: "none" }}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <ProviderBadge provider={id} size={24} interactive={false} sx={{ boxShadow: "none" }} />
      <Typography variant="body2" sx={{ flex: 1 }}>
        {name}
      </Typography>
      {first && (
        <Typography variant="caption" color="text.secondary">
          {t("dashboard.settings.opensFirst")}
        </Typography>
      )}
      <Tooltip title={onRemove ? "" : t("dashboard.settings.keepOne")}>
        <span>
          <Checkbox
            size="small"
            checked
            disabled={!onRemove}
            onChange={() => onRemove?.()}
            slotProps={{ input: { "aria-label": t("dashboard.settings.showProvider", { name }) } }}
          />
        </span>
      </Tooltip>
    </ListItem>
  );
}

/**
 * A text option, e.g. a custom widget's address or token. Saved when the field is left or Enter is pressed rather than
 * on every keystroke, as a custom widget redraws whenever its settings change.
 */
function TextSetting({
  label,
  value,
  placeholder,
  maxLength,
  secret,
  numeric,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  secret?: boolean;
  numeric?: boolean;
  onCommit: (value: string) => void;
}) {
  const { t } = useTranslation("app");
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <TextField
      size="small"
      value={draft}
      placeholder={placeholder}
      type={secret && !shown ? "password" : "text"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      sx={{ width: 240, maxWidth: "60%" }}
      slotProps={{
        htmlInput: {
          "aria-label": label,
          maxLength,
          inputMode: numeric ? "decimal" : undefined,
          autoComplete: secret ? "off" : undefined,
          spellCheck: false,
        },
        input: secret
          ? {
              endAdornment: (
                <IconButton
                  size="small"
                  edge="end"
                  aria-label={t(shown ? "dashboard.settings.hideSecret" : "dashboard.settings.showSecret")}
                  onClick={() => setShown((s) => !s)}
                >
                  {shown ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                </IconButton>
              ),
            }
          : undefined,
      }}
    />
  );
}
