import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { UnauthorizedError } from "../../api/client";
import { type Collection, type CollectionInput, collectionsApi } from "../../api/collections";
import { type PreviewMode } from "../../api/settings";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import CollectionCard from "./CollectionCard";
import CollectionFormModal from "./CollectionFormModal";
import CollectionsActionsMenu from "./CollectionsActionsMenu";

type Props = {
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
};

export default function CollectionsPage({ onUnauthorized, onBookmarksChanged, theme, previewMode }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  usePageHeader({
    actions: <CollectionsActionsMenu onAddCollection={() => setFormOpen(true)} />,
  });

  const handleError = (err: unknown, message?: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return true;
    }
    console.error(err);
    if (message) alert(message);
    return false;
  };

  const load = async () => {
    setLoading(true);
    try {
      setCollections(await collectionsApi.list());
    } catch (err) {
      handleError(err, t("models:collections.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createCollection = async (input: CollectionInput) => {
    await collectionsApi.create(input);
    await load();
  };

  const handleCollectionUpdated = (updated: Collection) => {
    setCollections(prev => prev.map(c => (c.id === updated.id ? updated : c)));
  };

  const handleCollectionDeleted = (id: string) => {
    setCollections(prev => prev.filter(c => c.id !== id));
  };

  return (
    <Stack spacing={2}>
      {loading ? (
        <Stack alignItems="center" sx={{ py: 8 }}>
          <CircularProgress size={22} />
        </Stack>
      ) : collections.length ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            columnGap: "20px",
            rowGap: "20px",
            "@media (max-width: 1979px)": { gridTemplateColumns: "repeat(6, 1fr)" },
            "@media (max-width: 1684px)": { gridTemplateColumns: "repeat(5, 1fr)" },
            "@media (max-width: 1404px)": { gridTemplateColumns: "repeat(4, 1fr)" },
            "@media (max-width: 1124px)": { gridTemplateColumns: "repeat(3, 1fr)" },
            "@media (max-width: 860px)": { gridTemplateColumns: "repeat(2, 1fr)" },
          }}
        >
          {collections.map(collection => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              theme={theme}
              previewMode={previewMode}
              onUpdated={handleCollectionUpdated}
              onDeleted={handleCollectionDeleted}
              onUnauthorized={onUnauthorized}
              onBookmarksChanged={onBookmarksChanged}
            />
          ))}
        </Box>
      ) : (
        <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
          <Typography variant="body2">{t("models:collections.empty")}</Typography>
        </Stack>
      )}

      {formOpen && (
        <CollectionFormModal onClose={() => setFormOpen(false)} onSubmit={createCollection} />
      )}
    </Stack>
  );
}
