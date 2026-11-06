import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import FilterPopoverButton from "../../components/controls/FilterPopoverButton";
import Segmented from "../../components/controls/Segmented";
import { PROVIDER_IDS } from "../../providers/index.generated";
import {
  activeFilterCount,
  FEATURES,
  hasFeature,
  hasNeed,
  NEEDS,
  NO_FILTERS,
  type ProviderFilters,
  type ProviderStatus,
  SIGN_INS,
  signInKind,
} from "./providerFilters";

const FEATURE_LABELS = {
  collections: "providerAbout.features.collections",
  likes: "providerAbout.features.likes",
  profiles: "providerAbout.features.profiles",
  paidModels: "providerAbout.features.paid",
} as const;

const NEED_LABELS = {
  grabOnly: "adminSettings.providers.filters.grabOnly",
  flaresolverr: "providerAbout.rows.flaresolverr",
} as const;

type Props = {
  filters: ProviderFilters;
  onChange: (filters: ProviderFilters) => void;
  /** How many are on, for the status toggle. */
  onCount: number;
  /** How many the filters let through. */
  shown: number;
};

const toggled = <T,>(list: readonly T[], value: T) =>
  list.includes(value) ? list.filter((other) => other !== value) : [...list, value];

/** What the admin page's grid shows: on or off first, then what they import, who signs in and what they need. */
export default function ProviderFiltersButton({ filters, onChange, onCount, shown }: Props) {
  const { t } = useTranslation(["app", "models"]);
  const total = PROVIDER_IDS.length;
  const statusOptions: { value: ProviderStatus; label: string }[] = [
    { value: "all", label: t("adminSettings.providers.status.all", { n: total }) },
    { value: "on", label: t("adminSettings.providers.status.on", { n: onCount }) },
    { value: "off", label: t("adminSettings.providers.status.off", { n: total - onCount }) },
  ];

  return (
    <FilterPopoverButton label={t("models:filters.title")} active={activeFilterCount(filters)}>
      <Stack spacing={1.5} sx={{ width: 340, maxWidth: "100%" }}>
        <Segmented
          fullWidth
          label={t("adminSettings.providers.status.label")}
          value={filters.status}
          options={statusOptions}
          onChange={(status) => onChange({ ...filters, status })}
        />
        <Group title={t("providerAbout.sections.imports")}>
          {FEATURES.map((feature) => (
            <Option
              key={feature}
              label={t(FEATURE_LABELS[feature])}
              count={PROVIDER_IDS.filter((id) => hasFeature(id, feature)).length}
              checked={filters.features.includes(feature)}
              onChange={() => onChange({ ...filters, features: toggled(filters.features, feature) })}
            />
          ))}
        </Group>
        <Group title={t("providerAbout.rows.signIn")}>
          {SIGN_INS.map((kind) => (
            <Option
              key={kind}
              label={t(`adminSettings.providers.filters.signIn.${kind}`)}
              count={PROVIDER_IDS.filter((id) => signInKind(id) === kind).length}
              checked={filters.signIns.includes(kind)}
              onChange={() => onChange({ ...filters, signIns: toggled(filters.signIns, kind) })}
            />
          ))}
        </Group>
        <Group title={t("providerAbout.sections.needs")}>
          {NEEDS.map((need) => (
            <Option
              key={need}
              label={t(NEED_LABELS[need])}
              count={PROVIDER_IDS.filter((id) => hasNeed(id, need)).length}
              checked={filters.needs.includes(need)}
              onChange={() => onChange({ ...filters, needs: toggled(filters.needs, need) })}
            />
          ))}
        </Group>
        <Divider />
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="caption" color="text.secondary" aria-live="polite">
            {t("adminSettings.providers.shown", { shown, total })}
          </Typography>
          {/* Never disabled: disabling it as it's clicked would drop focus out of the popover, and Escape with it. */}
          <Button size="small" onClick={() => onChange(NO_FILTERS)}>
            {t("models:filters.clear")}
          </Button>
        </Stack>
      </Stack>
    </FilterPopoverButton>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography
        variant="caption"
        component="legend"
        sx={{ p: 0, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "text.secondary" }}
      >
        {title}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 1 }}>{children}</Box>
    </Box>
  );
}

function Option({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <FormControlLabel
      sx={{ mr: 0, ml: -0.75, minWidth: 0, "& .MuiFormControlLabel-label": { flex: 1, minWidth: 0 } }}
      control={<Checkbox size="small" checked={checked} onChange={onChange} sx={{ p: 0.75 }} />}
      label={
        <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ color: (theme) => theme.thingport.headingText }}>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {count}
          </Typography>
        </Stack>
      }
    />
  );
}
