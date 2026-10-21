import { useCallback, useState } from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import type { DashboardModel } from "../../api/dashboard";
import { printsApi } from "../../api/prints";
import ModelRender from "../../components/media/ModelRender";
import { useCardPreview } from "../../hooks/useCardPreview";

const SIZE = 40;

/**
 * A dashboard list row's picture, led as the model cards are: the model's picture, or its render tinted with the
 * render colour. Either stands in for the other where it's missing.
 */
export default function DashboardModelThumb({ model }: { model: DashboardModel }) {
  const [preference] = useCardPreview();
  // The render that couldn't be shown, so a new one for this row still gets its try.
  const [failedRender, setFailedRender] = useState<string | null>(null);
  const onUnavailable = useCallback(() => setFailedRender(model.render_url), [model.render_url]);

  // Hidden until the choice is known, so the lists don't flash the wrong picture.
  if (preference === null) return <ListItemAvatar sx={{ minWidth: 48 }} />;
  const photo = model.thumb_url ? printsApi.fileUrl(model.thumb_url) : undefined;
  const photoAvatar = (
    <Avatar src={photo} variant="rounded" sx={{ width: SIZE, height: SIZE, color: "text.disabled" }}>
      <ViewInArIcon fontSize="small" />
    </Avatar>
  );
  const renderUrl =
    model.render_url && model.render_url !== failedRender && (preference === "renders" || !photo)
      ? model.render_url
      : null;
  return (
    <ListItemAvatar sx={{ minWidth: 48 }}>
      {renderUrl ? (
        <Box sx={{ width: SIZE, height: SIZE, borderRadius: 1, overflow: "hidden" }}>
          <ModelRender
            key={renderUrl}
            url={renderUrl}
            alt={model.name}
            onUnavailable={onUnavailable}
            placeholder={photo ? photoAvatar : undefined}
          />
        </Box>
      ) : (
        photoAvatar
      )}
    </ListItemAvatar>
  );
}
