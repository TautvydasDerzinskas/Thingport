import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import { UnauthorizedError } from "../../api/client";
import { aiConnectionsApi, type AiConnection } from "../../api/aiConnections";
import AiConnectionsSection from "./AiConnectionsSection";
import AiFeaturesSection from "./AiFeaturesSection";

type Props = {
  onUnauthorized?: () => void;
};

export default function AiPage({ onUnauthorized }: Props) {
  // Shared: a feature picks from the same models the grid shows.
  const [connections, setConnections] = useState<AiConnection[] | null>(null);
  // Opened from Studio's prompt to add an AI or pick the ones it offers: that dialog opens once, and the address
  // drops the ask, so going back or reloading doesn't open it again.
  const [searchParams, setSearchParams] = useSearchParams();
  const [asked] = useState(() => ({
    add: searchParams.get("add") === "model",
    studio: searchParams.get("feature") === "studio",
  }));
  useEffect(() => {
    if (asked.add || asked.studio) setSearchParams({}, { replace: true });
  }, [asked, setSearchParams]);

  const load = useCallback(() => {
    void aiConnectionsApi
      .list()
      .then(setConnections)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setConnections((current) => current ?? []);
      });
  }, [onUnauthorized]);
  useEffect(load, [load]);

  return (
    <Stack spacing={4} divider={<Divider />}>
      <AiConnectionsSection
        connections={connections}
        onChanged={load}
        onUnauthorized={onUnauthorized}
        startAdding={asked.add}
      />
      <AiFeaturesSection connections={connections} onUnauthorized={onUnauthorized} openStudio={asked.studio} />
    </Stack>
  );
}
