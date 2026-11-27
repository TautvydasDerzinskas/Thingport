import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import { studioApi } from "../../api/studio";
import HelpTip from "../../components/HelpTip";
import type { StudioPlate, StudioProfile } from "../../studio/document";
import { groupedPlateLabel } from "./labels";

type Props = {
  designId: string;
  version: number;
  plates: StudioPlate[];
  profiles: readonly StudioProfile[];
  /** The plate in view, pictured by the view itself rather than the server. */
  activePlate: string;
  snapshot: () => Promise<Blob | null>;
  value: string;
  onChange: (plateId: string) => void;
};

/** Which plate a model saved to the library is pictured by: a tile with a picture of each, one of them chosen. */
export default function PlatePictureTiles({
  designId,
  version,
  plates,
  profiles,
  activePlate,
  snapshot,
  value,
  onChange,
}: Props) {
  const { t } = useTranslation("app");
  // Each plate's picture as an object URL, or false where it couldn't be had.
  const [pictures, setPictures] = useState<Record<string, string | false>>({});
  // The URLs made, each let go once a newer picture of its plate replaces it, and all of them at the end.
  const urls = useRef<Record<string, string>>({});
  const ids = plates.map((plate) => plate.id).join(",");

  useEffect(
    () => () => {
      for (const url of Object.values(urls.current)) URL.revokeObjectURL(url);
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;
    for (const id of ids.split(",")) {
      const picture = id === activePlate ? snapshot() : studioApi.platePicture(designId, id, version);
      void picture
        .then((blob) => {
          if (cancelled) return;
          if (!blob) throw new Error("no picture");
          const url = URL.createObjectURL(blob);
          const old = urls.current[id];
          urls.current[id] = url;
          setPictures((prev) => ({ ...prev, [id]: url }));
          if (old) URL.revokeObjectURL(old);
        })
        .catch(() => {
          if (!cancelled) {
            const old = urls.current[id];
            if (old) {
              URL.revokeObjectURL(old);
              delete urls.current[id];
            }
            setPictures((prev) => ({ ...prev, [id]: false }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [designId, version, ids, activePlate, snapshot]);

  return (
    <Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 1 }}>
        <Typography
          variant="caption"
          component="h3"
          id="studio-save-picture"
          sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}
        >
          {t("studio.save.picture")}
        </Typography>
        <HelpTip text={t("studio.save.pictureHelp")} />
      </Stack>
      <Box
        role="radiogroup"
        aria-labelledby="studio-save-picture"
        sx={{ display: "flex", gap: 1.25, overflowX: "auto", pb: 0.5 }}
      >
        {plates.map((plate) => {
          const on = plate.id === value;
          const picture = pictures[plate.id];
          const name = groupedPlateLabel(plate, profiles, t);
          return (
            // A native radio in each tile: the arrow keys move the choice, as in any radio group.
            <Box
              key={plate.id}
              component="label"
              title={name}
              sx={(theme) => ({
                position: "relative",
                flexShrink: 0,
                width: 112,
                p: "5px",
                cursor: "pointer",
                border: 2,
                borderRadius: 1.5,
                borderColor: on ? "primary.main" : "transparent",
                boxShadow: on ? "none" : `inset 0 0 0 1px ${theme.palette.divider}`,
                bgcolor: on ? "action.selected" : "background.paper",
                transition: "border-color 150ms, background-color 150ms",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                "&:has(input:focus-visible)": {
                  outline: 2,
                  outlineColor: "primary.main",
                  outlineStyle: "solid",
                  outlineOffset: 2,
                },
              })}
            >
              <Box
                component="input"
                type="radio"
                name={`studio-save-picture-${designId}`}
                value={plate.id}
                checked={on}
                onChange={() => onChange(plate.id)}
                sx={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
              />
              <Box
                sx={{
                  height: 80,
                  borderRadius: 1,
                  overflow: "hidden",
                  bgcolor: "action.hover",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {picture === undefined ? (
                  <Skeleton variant="rectangular" width="100%" height={80} />
                ) : picture ? (
                  <Box
                    component="img"
                    src={picture}
                    alt=""
                    sx={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      "@keyframes platePictureIn": { from: { opacity: 0 } },
                      animation: "platePictureIn 200ms ease-out",
                      "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                    }}
                  />
                ) : (
                  <LayersOutlinedIcon sx={{ color: "text.disabled" }} />
                )}
              </Box>
              <Typography variant="caption" noWrap sx={{ display: "block", mt: 0.5, fontWeight: on ? 650 : 400 }}>
                {name}
              </Typography>
              {plate.id === activePlate && (
                <Typography
                  variant="caption"
                  sx={{
                    position: "absolute",
                    top: 9,
                    left: 9,
                    px: 0.75,
                    lineHeight: "18px",
                    borderRadius: 2,
                    bgcolor: "background.paper",
                    color: "text.secondary",
                    fontSize: 10,
                  }}
                >
                  {t("studio.save.inView")}
                </Typography>
              )}
              {on && (
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                  }}
                >
                  <CheckRoundedIcon sx={{ fontSize: 14 }} />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
