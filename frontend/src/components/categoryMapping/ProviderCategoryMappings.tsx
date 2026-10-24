import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TuneIcon from "@mui/icons-material/Tune";
import { IMPORT_PROVIDER_INFO } from "../../constants/importProviders";
import { useDisabledProviders } from "../../hooks/useProviders";
import type { ImportProvider } from "../../api/settings";
import { ProviderLogo } from "../Layout/ConfigurationDialog/providerLogos";
import ProviderCategoryPicker from "./ProviderCategoryPicker";
import { PROVIDER_IDS } from "../../providers/_generated";
import { indexCatalog, joinCatIds, loadProviderCatalog, splitCatIds, type CatalogCategory } from "./providerCatalog";

/** The providers a category can take imports from, in the order the rows show them. */
export const MAPPED_PROVIDERS: readonly ImportProvider[] = PROVIDER_IDS;
export type MappedProvider = ImportProvider;

type Props = {
  /** Each provider's stored ids, ";"-separated. */
  value: Record<MappedProvider, string>;
  onChange: (provider: MappedProvider, value: string) => void;
  /** The Thingport category being mapped. */
  categoryName: string;
  disabled?: boolean;
};

/** One row per provider: what its imports bring into this category, by name, and a button to change it. Providers an
 *  admin turned off are hidden; their mapping is kept. */
export default function ProviderCategoryMappings({ value, onChange, categoryName, disabled }: Props) {
  const { t } = useTranslation("models");
  const disabledProviders = useDisabledProviders();
  const [indexes, setIndexes] = useState<Record<string, Map<string, CatalogCategory>> | null>(null);
  const [editing, setEditing] = useState<MappedProvider | null>(null);

  useEffect(() => {
    let active = true;
    loadProviderCatalog()
      .then((catalog) => {
        if (!active) return;
        setIndexes(Object.fromEntries(Object.entries(catalog).map(([id, entries]) => [id, indexCatalog(entries)])));
      })
      // The names are a nicety here: without them the rows still count, and the picker says what went wrong.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const shown = MAPPED_PROVIDERS.filter((provider) => !disabledProviders.has(provider));

  return (
    <>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: "12px", overflow: "hidden" }}>
        {shown.map((provider, i) => {
          const ids = splitCatIds(value[provider]);
          const names = ids.map(
            (id) => indexes?.[provider]?.get(id)?.name ?? t("categories.manager.mapping.unknown", { id }),
          );
          const name = IMPORT_PROVIDER_INFO[provider].label;
          return (
            <Box key={provider}>
              {i > 0 && <Divider />}
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.5, py: 1 }}>
                <Box sx={{ color: "text.primary", flexShrink: 0 }}>
                  <ProviderLogo id={provider} size={22} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={ids.length ? "text.secondary" : "text.disabled"}
                    noWrap
                    component="p"
                    title={names.join(", ")}
                  >
                    {ids.length ? names.join(", ") : t("categories.manager.mapping.none")}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant={ids.length ? "contained" : "outlined"}
                  disableElevation
                  startIcon={<TuneIcon fontSize="small" />}
                  onClick={() => setEditing(provider)}
                  disabled={disabled}
                  aria-label={t("categories.manager.mapping.manageLabel", { provider: name, count: ids.length })}
                  sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
                >
                  {t("categories.manager.mapping.manage", { count: ids.length })}
                </Button>
              </Stack>
            </Box>
          );
        })}
      </Box>
      {editing && (
        <ProviderCategoryPicker
          provider={editing}
          providerName={IMPORT_PROVIDER_INFO[editing].label}
          categoryName={categoryName}
          selected={splitCatIds(value[editing])}
          onClose={() => setEditing(null)}
          onDone={(ids) => {
            onChange(editing, joinCatIds(ids));
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
