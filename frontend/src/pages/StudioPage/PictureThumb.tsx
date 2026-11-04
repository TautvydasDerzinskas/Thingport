import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import { studioApi } from "../../api/studio";

// A picture a design keeps, small: in a prompt and in the conversation. Fetched once a page, as it never changes.

const urls = new Map<string, Promise<string>>();

function pictureUrl(designId: string, pictureId: string): Promise<string> {
  const key = `${designId}/${pictureId}`;
  let url = urls.get(key);
  if (!url) {
    url = studioApi.picture(designId, pictureId).then((blob) => URL.createObjectURL(blob));
    url.catch(() => urls.delete(key));
    urls.set(key, url);
  }
  return url;
}

type Props = {
  /** Either a kept picture, or a file's own address while it's on its way. */
  source: { designId: string; pictureId: string } | { url: string };
  size: number;
  alt: string;
  dim?: boolean;
};

export default function PictureThumb({ source, size, alt, dim }: Props) {
  const local = "url" in source ? source.url : null;
  const key = "url" in source ? null : `${source.designId}/${source.pictureId}`;
  const [fetched, setFetched] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if ("url" in source) return;
    let active = true;
    pictureUrl(source.designId, source.pictureId).then(
      (url) => active && setFetched({ key: `${source.designId}/${source.pictureId}`, url }),
      () => undefined,
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const url = local ?? (fetched?.key === key ? fetched.url : null);
  if (!url) return <Skeleton variant="rounded" width={size} height={size} />;
  return (
    <Box
      component="img"
      src={url}
      alt={alt}
      sx={{
        width: size,
        height: size,
        objectFit: "cover",
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        display: "block",
        bgcolor: "background.default",
        opacity: dim ? 0.5 : 1,
        transition: "opacity 150ms",
      }}
    />
  );
}
