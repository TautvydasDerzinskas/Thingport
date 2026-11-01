import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import { type Print, printsApi } from "../../api/prints";
import MergeDialog, { type MergeItem } from "../MergeDialog";
import { useToast } from "../ToastProvider";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The models to merge: the selected ones that can be. */
  prints: Print[];
  /** Selected models left out because they can't be merged. */
  skipped: number;
  onMerged: (primary: Print, mergedIds: string[]) => void;
  onUnauthorized?: () => void;
};

/** Merges models whose parts each arrived as a model of their own into the one the user picks. */
export default function MergeModelsDialog({ open, onClose, prints, skipped, onMerged, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const skippedText = skipped > 0 ? t("models:selection.skipped", { count: skipped }) : null;

  const items: MergeItem[] = prints.map((print) => {
    const picture = print.preview_images[0]?.url ?? print.thumb_url;
    const files = print.plates.length + print.supporting_file_count;
    return {
      key: print.id,
      name: print.title || print.name,
      count: files,
      caption: `${t("models:merge.models.fileCount", { count: files })} · ${t("models:merge.models.pictureCount", {
        count: print.preview_images.length,
      })}`,
      bookmarked: false,
      thumbnail: picture ? (
        <Box
          component="img"
          src={printsApi.fileUrl(picture)}
          alt=""
          sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <Stack alignItems="center" justifyContent="center" sx={{ height: "100%", color: "text.disabled" }}>
          <ViewInArOutlinedIcon fontSize="small" />
        </Stack>
      ),
    };
  });

  const merge = async (primary: MergeItem, others: MergeItem[]) => {
    const result = await printsApi.merge(
      primary.key,
      others.map((item) => item.key),
    );
    onMerged(result.print, result.merged_ids);
    const merged = t("models:merge.models.merged", { count: others.length, name: primary.name });
    showToast({ message: skippedText ? `${merged} ${skippedText}` : merged, severity: "success" });
  };

  return (
    <MergeDialog
      open={open}
      onClose={onClose}
      kind="model"
      items={items}
      // Everything needed is already on the grid's models, and the total doesn't depend on which is kept.
      loadPreview={() => Promise.resolve({ models: items.reduce((sum, item) => sum + item.count, 0) })}
      onMerge={merge}
      onUnauthorized={onUnauthorized}
      notice={
        skippedText && (
          <Alert severity="info" sx={{ py: 0.25 }}>
            {skippedText}
          </Alert>
        )
      }
    />
  );
}
