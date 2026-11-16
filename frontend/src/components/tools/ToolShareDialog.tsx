import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { toolsApi, type ToolPerson } from "../../api/tools";
import { UnauthorizedError } from "../../api/client";
import type { SdkAudience } from "../../sdk/types";
import Segmented from "../controls/Segmented";
import { ListRowSkeletons } from "../ListSkeleton";
import PeoplePicker from "../PeoplePicker";
import { useToast } from "../ToastProvider";

type Props = {
  open: boolean;
  /** The tool whose shared entries it's about; kept while it closes. */
  tool: { id: string; name: string } | null;
  /** What was chosen and saved, or null when closed without saving. */
  onClose: (audience: SdkAudience | null) => void;
  onUnauthorized?: () => void;
};

/** Whom the user's shared entries in a tool reach: everyone who can use tools, or the people they pick. */
export default function ToolShareDialog({ open, tool, onClose, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const [everyone, setEveryone] = useState(true);
  const [people, setPeople] = useState<ToolPerson[] | null>(null);
  const [saving, setSaving] = useState(false);
  const toolId = tool?.id ?? null;

  useEffect(() => {
    if (!open || !toolId) return;
    let active = true;
    setPeople(null);
    toolsApi.audience(toolId).then(
      (audience) => {
        if (!active) return;
        setEveryone(audience.everyone);
        setPeople(audience.people);
      },
      (err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        setPeople([]);
      },
    );
    return () => {
      active = false;
    };
  }, [open, toolId, onUnauthorized]);

  const save = async () => {
    if (!toolId || !people) return;
    setSaving(true);
    try {
      const audience = await toolsApi.setAudience(toolId, {
        everyone,
        userIds: everyone ? [] : people.map((person) => person.id),
      });
      onClose({
        everyone: audience.everyone,
        people: audience.people.map((p) => ({ id: p.id, name: p.display_name, avatarUrl: p.avatar_url })),
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open && Boolean(tool)} onClose={() => onClose(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{t("tools.share.title", { name: tool?.name ?? "" })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Segmented
            label={t("tools.share.title", { name: tool?.name ?? "" })}
            value={everyone ? "everyone" : "people"}
            onChange={(value) => setEveryone(value === "everyone")}
            options={[
              { value: "everyone", label: t("tools.share.everyone") },
              { value: "people", label: t("tools.share.people") },
            ]}
            fullWidth
            disabled={saving || people === null}
          />
          {!everyone &&
            (people === null ? (
              <ListRowSkeletons count={3} lead="circle" leadSize={32} />
            ) : (
              <>
                <PeoplePicker
                  search={(query) => (toolId ? toolsApi.people(toolId, query) : Promise.resolve([]))}
                  selected={people}
                  onSelectedChange={setPeople}
                  disabled={saving}
                  onUnauthorized={onUnauthorized}
                  height={220}
                />
                <Typography variant="caption" color="text.secondary">
                  {people.length ? t("tools.share.picked", { count: people.length }) : t("tools.share.onlyYou")}
                </Typography>
              </>
            ))}
          {everyone && (
            <Typography variant="body2" color="text.secondary">
              {t("tools.share.everyoneHint")}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={() => onClose(null)} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || people === null}>
          {t("common:save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
