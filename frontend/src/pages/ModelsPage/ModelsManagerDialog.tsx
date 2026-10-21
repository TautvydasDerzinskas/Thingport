import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import type { Category, CategoryKind, CategoryMetaInput } from "../../api/categories";
import type { Print } from "../../api/prints";
import { aiCategorizationApi } from "../../api/aiCategorization";
import { categoriesApi, resetIsNoop } from "../../api/categories";
import { UnauthorizedError } from "../../api/client";
import SectionedDialog from "../../components/SectionedDialog";
import CategoryManager from "./CategoryManager";
import AiCategorizationPanel from "./AiCategorizationPanel";

export type ModelsManagerSection = "categories" | "folders" | "ai";

type Props = {
  /** The section to open on, or null when closed. */
  open: ModelsManagerSection | null;
  onClose: () => void;
  /** Both kinds; each section shows its own. */
  categories: Category[];
  onCreate: (name: string, parentId: string | null, kind: CategoryKind) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (categoryIds: string[]) => Promise<void>;
  onMove: (id: string, parentId: string | null, position: number) => Promise<void>;
  onUpdateMeta: (id: string, meta: CategoryMetaInput) => Promise<void>;
  onResetCategories: () => Promise<void>;
  onPrintUpdated?: (print: Print) => void;
  onLibraryChanged?: () => void;
  onUnauthorized?: () => void;
};

/** Categories, folders and AI categorization in one place, opened from the side panel's cog. */
export default function ModelsManagerDialog({
  open,
  onClose,
  categories,
  onCreate,
  onResetCategories,
  onPrintUpdated,
  onLibraryChanged,
  onUnauthorized,
  ...handlers
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [section, setSection] = useState<ModelsManagerSection>("categories");
  const [aiEnabled, setAiEnabled] = useState(false);

  // Kept while closing, so the section doesn't switch during the fade.
  useEffect(() => {
    if (open) setSection(open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void aiCategorizationApi
      .status()
      .then((status) => {
        if (active) setAiEnabled(status.enabled);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      });
    return () => {
      active = false;
    };
  }, [open, onUnauthorized]);

  // Null until known; the reset button stays off meanwhile, as a reset at the defaults changes nothing.
  const [categoriesAtDefaults, setCategoriesAtDefaults] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void categoriesApi
      .previewReset()
      .then((preview) => {
        if (active) setCategoriesAtDefaults(resetIsNoop(preview));
      })
      .catch((err: unknown) => {
        if (!active) return;
        // Unknown leaves the reset available.
        setCategoriesAtDefaults(false);
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      });
    return () => {
      active = false;
    };
    // Rechecked whenever the categories change.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [open, categories, onUnauthorized]);

  const byKind = useMemo(
    () => ({
      category: categories.filter((c) => c.kind === "category"),
      folder: categories.filter((c) => c.kind === "folder"),
    }),
    [categories],
  );

  const sections = [
    { id: "categories" as const, label: t("models:categories.title"), icon: <CategoryOutlinedIcon fontSize="small" /> },
    { id: "folders" as const, label: t("models:folders.title"), icon: <FolderOutlinedIcon fontSize="small" /> },
    ...(aiEnabled
      ? [
          {
            id: "ai" as const,
            label: t("models:aiCategorization.section"),
            icon: <AutoAwesomeOutlinedIcon fontSize="small" />,
          },
        ]
      : []),
  ];

  const managerFor = (kind: CategoryKind) => (
    <CategoryManager
      key={kind}
      kind={kind}
      categories={byKind[kind]}
      onCreate={(name, parentId) => onCreate(name, parentId, kind)}
      // Only categories have a starter tree; folders are the user's own.
      onResetDefaults={kind === "category" ? onResetCategories : undefined}
      atDefaults={categoriesAtDefaults !== false}
      onUnauthorized={onUnauthorized}
      {...handlers}
    />
  );

  return (
    <SectionedDialog
      open={Boolean(open)}
      onClose={onClose}
      title={t("models:manager.title")}
      sections={sections}
      section={section}
      onSectionChange={setSection}
      size="large"
    >
      {section === "categories" && managerFor("category")}
      {section === "folders" && managerFor("folder")}
      {section === "ai" && (
        <AiCategorizationPanel
          onUnauthorized={onUnauthorized}
          onPrintUpdated={onPrintUpdated}
          onLibraryChanged={onLibraryChanged}
          onRunStarted={onClose}
        />
      )}
    </SectionedDialog>
  );
}
