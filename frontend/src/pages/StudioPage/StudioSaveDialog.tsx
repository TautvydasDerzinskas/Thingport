import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import DoNotDisturbAltOutlinedIcon from "@mui/icons-material/DoNotDisturbAltOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import SearchIcon from "@mui/icons-material/Search";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import type { Print } from "../../api/prints";
import type { StudioDesign } from "../../api/studio";
import { ModelThumb, useLibraryModels } from "../../components/ModelPickerDialog";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import Segmented from "../../components/controls/Segmented";
import HelpTip from "../../components/HelpTip";
import GeneratePicturesDialog from "../../components/media/GeneratePicturesDialog";
import {
  addPicturesOnSave,
  rememberAddPicturesOnSave,
  rememberedShots,
  type Shot,
} from "../../utils/scenePictures/scenes";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
import { printPreset, suggestPresets, type PrintPresetId } from "../../studio/printProfile";
import {
  defaultPrinter,
  defaultSlicer,
  PRESET_ICONS,
  PresetGrid,
  profileLine,
  slicerName,
  suggestedProfileName,
} from "./printProfileUi";
import type { RunCommand } from "./useStudioDesign";
import PlatePictureTiles from "./PlatePictureTiles";
import { exportableProfiles, picturablePlates, profileSettings, studioPlates } from "../../studio/document";
import { profileLabel } from "./labels";

// Save to Thingport: the design as a new model, or as one more print profile of a model the person already has, with
// its print profile settled first: chosen by the person, suggested by Studio's assistant, or left out.

/** `name` is a new model's; a profile added to a model takes none. `picturePlate` is the plate a new model is
 *  pictured by; `pictures` the generated pictures added after it's saved. */
export type StudioSaveRequest = {
  name?: string;
  modelId?: string;
  profileName?: string;
  picturePlate?: string;
  pictures?: Shot[];
};

type Mode = "new" | "add";
type Choice = "myself" | "ai" | "without";

/** What the person filled in, kept while they set the profile in the Print tab. */
export type StudioSaveDraft = {
  mode: Mode;
  name: string;
  model: Print | null;
  choice: Choice;
  profileName: string;
  nameTouched: boolean;
  picturePlate: string | null;
  /** The generated pictures to add, or null for none. */
  pictures: Shot[] | null;
};

type Props = {
  design: StudioDesign;
  run: RunCommand;
  canAskAi: boolean;
  aiBusy: boolean;
  onSuggestAi: () => void;
  /** The design came from requests to the assistant, so asking it again comes first. */
  madeByPrompts: boolean;
  about: string;
  saving: boolean;
  /** The dialog as it was left for the Print tab, to open it with again. */
  draft?: StudioSaveDraft | null;
  /** The plate in view, which a new model is pictured by unless another is chosen, and a picture of it as shown. */
  activePlate: string;
  snapshot: () => Promise<Blob | null>;
  onEditProfile: (draft: StudioSaveDraft, profileId?: string) => void;
  onSave: (request: StudioSaveRequest) => void;
  onClose: () => void;
  onUnauthorized?: () => void;
};

export default function StudioSaveDialog({
  design,
  run,
  canAskAi,
  aiBusy,
  onSuggestAi,
  madeByPrompts,
  about,
  saving,
  draft,
  activePlate,
  snapshot,
  onEditProfile,
  onSave,
  onClose,
  onUnauthorized,
}: Props) {
  const { t } = useTranslation(["app", "common", "models"]);
  const settings = useSlicerSettings();
  const { printers } = useUserPrinters();
  const groups = exportableProfiles(design.document);
  const namedProfiles = Boolean(design.document.profiles);
  const profile = namedProfiles ? undefined : design.document.print_profile;
  const [mode, setMode] = useState<Mode>(draft?.mode ?? "new");
  const [name, setName] = useState(draft?.name ?? design.name);
  const [model, setModel] = useState<Print | null>(draft?.model ?? null);
  const [choice, setChoice] = useState<Choice>(draft?.choice ?? (canAskAi && madeByPrompts ? "ai" : "myself"));
  const [profileName, setProfileName] = useState(draft?.profileName ?? "");
  const [nameTouched, setNameTouched] = useState(draft?.nameTouched ?? false);
  // Offered when there's a choice: shown plates with something to picture. The plate in view first, if it's one.
  const picturable = picturablePlates(design.document);
  const picturePlates = studioPlates(design.document).filter((plate) => picturable.includes(plate.id));
  const [chosenPicture, setChosenPicture] = useState<string | null>(draft?.picturePlate ?? null);
  const [pictures, setPictures] = useState<Shot[] | null>(() =>
    draft ? draft.pictures : addPicturesOnSave() ? rememberedShots() : null,
  );
  const [choosingPictures, setChoosingPictures] = useState(false);
  const picturePlate =
    [chosenPicture, activePlate].find((id) => id && picturable.includes(id)) ?? picturable[0] ?? null;
  const { query, setQuery, debounced, models, failed } = useLibraryModels(onUnauthorized);
  const suggested = suggestPresets(about)
    .slice(0, 2)
    .map((hit) => hit.id);

  // The profile's name follows the profile until the person types their own.
  const proposed = profile ? suggestedProfileName(t, profile, printers) : "";
  useEffect(() => {
    if (!nameTouched) setProfileName(proposed);
  }, [proposed, nameTouched]);

  const pickPreset = (preset: PrintPresetId) => {
    const slicer = defaultSlicer(settings);
    const printer = defaultPrinter(printers, settings, slicer);
    void run("set_print_profile", { profile: { preset, slicer, ...(printer ? { printer } : {}) } });
  };
  const choose = (next: Choice) => {
    setChoice(next);
    if (next === "ai" && !aiBusy) onSuggestAi();
  };
  const profilesOf = (entry: Print) => entry.plates.filter((plate) => plate.profile_id).length;
  const ready =
    groups.length > 0 &&
    (namedProfiles
      ? mode === "new"
        ? Boolean(name.trim())
        : Boolean(model)
      : mode === "new"
        ? Boolean(name.trim()) && (Boolean(profile) || choice === "without")
        : Boolean(model && profile && profileName.trim()));
  const editProfile = (profileId?: string) =>
    onEditProfile(
      { mode, name, model, choice, profileName, nameTouched, picturePlate: chosenPicture, pictures },
      profileId,
    );

  const save = () => {
    if (!ready) return;
    if (mode === "new") rememberAddPicturesOnSave(Boolean(pictures));
    onSave(
      mode === "new"
        ? {
            name: name.trim(),
            ...(profile ? { profileName: profileName.trim() || undefined } : {}),
            ...(picturePlate ? { picturePlate } : {}),
            ...(pictures ? { pictures } : {}),
          }
        : { modelId: model!.id, ...(profile ? { profileName: profileName.trim() } : {}) },
    );
  };

  const choices: { id: Choice; icon: ReactNode; title: string; hint: string; hidden?: boolean }[] = [
    {
      id: "myself",
      icon: <TuneOutlinedIcon fontSize="small" />,
      title: t("studio.save.chooseMyself"),
      hint: t("studio.save.chooseMyselfHint"),
    },
    {
      id: "ai",
      icon: <AutoAwesomeOutlinedIcon fontSize="small" />,
      title: t("studio.printProfile.suggestAi"),
      hint: t("studio.save.suggestAiHint"),
      hidden: !canAskAi,
    },
    {
      id: "without",
      icon: <DoNotDisturbAltOutlinedIcon fontSize="small" />,
      title: t("studio.save.without"),
      hint: t("studio.save.withoutHint"),
      hidden: mode === "add",
    },
  ];
  const shown = choices.filter((entry) => !entry.hidden);
  const ordered =
    canAskAi && madeByPrompts
      ? [...shown.filter((entry) => entry.id === "ai"), ...shown.filter((entry) => entry.id !== "ai")]
      : shown;
  const preset = printPreset(profile?.preset);
  const Icon = preset ? PRESET_ICONS[preset.id] : PrintOutlinedIcon;

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("studio.design.saveToLibrary")}</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2, pt: "4px !important" }}>
        <Segmented
          label={t("studio.save.destination")}
          value={mode}
          onChange={(next) => {
            setMode(next);
            if (next === "add" && choice === "without") setChoice("myself");
          }}
          options={[
            { value: "new", label: t("studio.save.newModel") },
            { value: "add", label: t("studio.save.addToModel") },
          ]}
        />

        {mode === "new" ? (
          <TextField
            size="small"
            label={t("studio.design.libraryModelName")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
        ) : (
          <Box>
            <TextField
              size="small"
              fullWidth
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("modelPicker.search")}
              slotProps={{
                htmlInput: { "aria-label": t("modelPicker.search") },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Box sx={{ height: 200, overflowY: "auto", mt: 1, mx: -1 }}>
              {failed ? (
                <Alert severity="error" sx={{ mx: 1 }}>
                  {t("modelPicker.loadFailed")}
                </Alert>
              ) : models === null ? (
                <ListRowSkeletons count={4} lead="rounded" leadSize={36} />
              ) : models.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 3, textAlign: "center" }}>
                  {debounced ? t("modelPicker.noMatch") : t("modelPicker.emptyLibrary")}
                </Typography>
              ) : (
                <List dense disablePadding aria-label={t("studio.save.pickModel")}>
                  {models.map((entry) => {
                    const count = profilesOf(entry);
                    return (
                      <ListItemButton
                        key={entry.id}
                        selected={entry.id === model?.id}
                        onClick={() => setModel(entry)}
                        sx={{ borderRadius: 1, gap: 1.5 }}
                      >
                        <ModelThumb url={entry.thumb_url} size={36} />
                        <ListItemText
                          primary={entry.title || entry.name}
                          secondary={count ? t("studio.save.profiles", { count }) : t("studio.save.noProfiles")}
                          primaryTypographyProps={{ variant: "body2", noWrap: true }}
                          secondaryTypographyProps={{ variant: "caption", noWrap: true }}
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              )}
            </Box>
          </Box>
        )}

        {mode === "new" && picturePlates.length > 1 && picturePlate && (
          <PlatePictureTiles
            designId={design.id}
            version={design.version}
            plates={picturePlates}
            profiles={groups}
            activePlate={activePlate}
            snapshot={snapshot}
            value={picturePlate}
            onChange={setChosenPicture}
          />
        )}

        {mode === "new" && (
          <Box>
            <Typography
              variant="caption"
              component="h3"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                mb: 0.5,
                fontWeight: 700,
                color: "text.secondary",
                textTransform: "uppercase",
              }}
            >
              {t("studio.save.pictures")}
              <HelpTip text={t("studio.save.picturesHelp")} />
            </Typography>
            <Stack
              direction="row"
              sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}
            >
              <Stack direction="row" sx={{ alignItems: "center", minWidth: 0 }}>
                <Switch
                  checked={Boolean(pictures)}
                  onChange={(e) => setPictures(e.target.checked ? rememberedShots() : null)}
                  disabled={saving}
                  slotProps={{ input: { "aria-label": t("studio.save.addPictures") } }}
                />
                <Typography variant="body2">{t("studio.save.addPictures")}</Typography>
              </Stack>
              {pictures && (
                <Stack direction="row" sx={{ alignItems: "center", gap: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {pictures.map((shot) => t(`models:scenePictures.scenes.${shot.scene}`)).join(" · ")}
                  </Typography>
                  <Button size="small" onClick={() => setChoosingPictures(true)} disabled={saving}>
                    {t("studio.save.changePictures")}
                  </Button>
                </Stack>
              )}
            </Stack>
          </Box>
        )}

        <Box>
          <Typography
            variant="caption"
            component="h3"
            sx={{ display: "block", mb: 1, fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}
          >
            {t(namedProfiles ? "studio.profiles.title" : "studio.printProfile.title")}
          </Typography>
          {!groups.length ? (
            <Typography variant="body2" color="text.secondary">
              {t("studio.design.nothingToExport")}
            </Typography>
          ) : namedProfiles ? (
            <Stack spacing={0.75}>
              {groups.map((group) => {
                const profileConfig = profileSettings(design.document, group.id).print_profile;
                return (
                  <Stack key={group.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {profileLabel(group, t)}
                      </Typography>
                      {profileConfig && (
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                          {[slicerName(profileConfig.slicer), profileLine(t, profileConfig)]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      )}
                    </Box>
                    <Button size="small" onClick={() => editProfile(group.id)}>
                      {t("studio.profiles.settings")}
                    </Button>
                  </Stack>
                );
              })}
            </Stack>
          ) : profile ? (
            <Stack spacing={1.5}>
              <Box
                sx={{
                  display: "flex",
                  gap: 1.25,
                  alignItems: "center",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1.5,
                  p: 1.25,
                }}
              >
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 1,
                    color: "primary.main",
                    bgcolor: "action.hover",
                  }}
                >
                  <Icon fontSize="small" />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                    <Typography variant="subtitle2" noWrap>
                      {preset ? t(`studio.printProfile.preset.${preset.id}.title`) : t("studio.printProfile.custom")}
                    </Typography>
                    {profile.by && profile.by !== "person" && (
                      <AutoAwesomeOutlinedIcon
                        sx={{ fontSize: 16, color: "primary.main" }}
                        aria-label={t("studio.printProfile.byAi")}
                      />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    {[slicerName(profile.slicer), profileLine(t, profile)].filter(Boolean).join(" · ")}
                  </Typography>
                </Box>
                <Button size="small" onClick={() => editProfile()}>
                  {t("studio.save.editProfile")}
                </Button>
              </Box>
              <TextField
                size="small"
                label={t("studio.save.profileName")}
                value={profileName}
                onChange={(event) => {
                  setNameTouched(true);
                  setProfileName(event.target.value);
                }}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              <Box
                component="fieldset"
                aria-label={t("studio.printProfile.title")}
                sx={{
                  border: 0,
                  m: 0,
                  p: 0,
                  minWidth: 0,
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: `repeat(${ordered.length}, minmax(0, 1fr))` },
                  gap: 1,
                }}
              >
                {ordered.map((entry) => {
                  const on = entry.id === choice;
                  return (
                    <ButtonBase
                      key={entry.id}
                      aria-pressed={on}
                      onClick={() => choose(entry.id)}
                      sx={(theme) => ({
                        justifyContent: "flex-start",
                        alignItems: "flex-start",
                        gap: 1,
                        p: 1.25,
                        textAlign: "left",
                        border: 1.5,
                        borderRadius: 1.5,
                        borderColor: on ? "primary.main" : "divider",
                        bgcolor: on ? "action.selected" : "background.paper",
                        transition: "border-color 150ms, background-color 150ms",
                        "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                      })}
                    >
                      <Box sx={{ color: entry.id === "without" ? "text.secondary" : "primary.main", mt: "2px" }}>
                        {entry.icon}
                      </Box>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 650 }}>
                          {entry.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {entry.hint}
                        </Typography>
                      </Box>
                    </ButtonBase>
                  );
                })}
              </Box>
              {choice === "myself" && (
                <PresetGrid t={t} value={null} suggested={suggested} columns={3} onPick={pickPreset} />
              )}
              {choice === "ai" && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
                  {aiBusy ? (
                    <>
                      <CircularProgress size={16} />
                      <Typography variant="body2">{t("studio.printProfile.aiWorking")}</Typography>
                    </>
                  ) : (
                    <Button size="small" startIcon={<AutoAwesomeOutlinedIcon />} onClick={onSuggestAi}>
                      {t("studio.save.askAi")}
                    </Button>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === "add" && model && groups.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mr: "auto" }}>
            {t("studio.save.willHave", { name: model.title || model.name, count: profilesOf(model) + groups.length })}
          </Typography>
        )}
        <Button disabled={saving} onClick={onClose}>
          {t("common:cancel")}
        </Button>
        <Button variant="contained" disabled={!ready || saving} onClick={save}>
          {mode === "add" ? t(groups.length === 1 ? "studio.save.addProfile" : "common:add") : t("common:save")}
        </Button>
      </DialogActions>
      {choosingPictures && pictures && (
        <GeneratePicturesDialog
          open
          onClose={() => setChoosingPictures(false)}
          modelName={name}
          files={[]}
          existingCount={1}
          initialShots={pictures}
          onChoose={setPictures}
        />
      )}
    </Dialog>
  );
}
