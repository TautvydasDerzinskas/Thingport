import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { UnauthorizedError } from "../../../api/client";
import { sendTargetsApi, type SendTarget } from "../../../api/sendTargets";
import { useConfirm } from "../../ConfirmProvider";
import Segmented from "../../controls/Segmented";
import { ListRowSkeletons } from "../../ListSkeleton";
import SendTargetEditor from "../../sendTo/SendTargetEditor";
import { SEND_GROUPS, SEND_KINDS, SendKindIcon, kindOfHow, type SendKind } from "../../sendTo/sendKinds";
import { useToast } from "../../ToastProvider";
import { reloadSlicerSettings } from "../../../hooks/useSlicerPreference";
import { PanelHeader } from "./parts";

type Props = { onUnauthorized?: () => void };

// A row arriving: one added, imported or read in.
const rowIn = keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; }`;

/** Where a row's address goes: its host, or the app a link opens. */
function whereOf(target: SendTarget): string {
  const address = target.how.type === "preset" ? target.how.address : target.how.url;
  try {
    const url = new URL(address.replace(/\{[a-z_]+\}/g, "x"));
    return url.host || url.protocol.replace(/:$/, "");
  } catch {
    return address;
  }
}

/**
 * The user's Send to destinations: printers, webhooks and addresses of their own that a model's file goes to from
 * its page. Each row shows where it sends and whether it's its own button or in the menu; clicking it opens its
 * settings in place.
 */
export default function SendToPanel({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const toast = useToast();
  const confirm = useConfirm();
  const [targets, setTargets] = React.useState<SendTarget[] | null>(null);
  // The row open for editing, or a new one of a kind not saved yet.
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<SendKind | null>(null);
  const [addAnchor, setAddAnchor] = React.useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = React.useState<HTMLElement | null>(null);
  const [rowMenu, setRowMenu] = React.useState<{ anchor: HTMLElement; target: SendTarget } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const s = (key: string, vars?: Record<string, unknown>) => t(`app:configuration.sendTo.${key}`, vars);

  const failed = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    },
    [onUnauthorized, toast],
  );

  React.useEffect(() => {
    let active = true;
    sendTargetsApi.list().then(
      (list) => active && setTargets(list),
      (err) => {
        if (!active) return;
        setTargets([]);
        failed(err);
      },
    );
    return () => {
      active = false;
    };
  }, [failed]);

  // Every change reaches the model pages too, through the slicer settings they read. Applied to the list as it is
  // when the answer comes, so two saves at once both stay.
  const changed = (update: (list: SendTarget[]) => SendTarget[]) => {
    setTargets((list) => update(list ?? []));
    void reloadSlicerSettings();
  };
  // Each answer takes only what its request set: a placement, or the rest. So two of them for one destination, the
  // row's toggle and its editor, can come back in either order.
  const replaced = (saved: SendTarget, only: "placement" | "settings") => (list: SendTarget[]) =>
    list.map((other) =>
      other.id !== saved.id
        ? other
        : only === "placement"
          ? { ...other, placement: saved.placement }
          : { ...saved, placement: other.placement },
    );

  const add = (kind: SendKind) => {
    setAddAnchor(null);
    setEditing(null);
    setAdding(kind);
  };

  const remove = async (target: SendTarget) => {
    setRowMenu(null);
    const sure = await confirm({
      title: s("deleteTitle", { name: target.name }),
      message: s("deleteMessage"),
      confirmLabel: s("delete"),
      destructive: true,
    });
    if (!sure) return;
    try {
      await sendTargetsApi.remove(target.id);
      changed((list) => list.filter((other) => other.id !== target.id));
    } catch (err) {
      failed(err);
    }
  };

  const place = async (target: SendTarget, placement: SendTarget["placement"]) => {
    try {
      changed(replaced(await sendTargetsApi.place(target.id, placement), "placement"));
    } catch (err) {
      failed(err);
    }
  };

  const exportAll = async () => {
    setMoreAnchor(null);
    try {
      const file = await sendTargetsApi.exportAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "thingport-send-to.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      failed(err);
    }
  };

  const importFile = async (file: File) => {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(s("importFailed"));
      }
      const added = await sendTargetsApi.importAll(parsed);
      changed((list) => [...list, ...added]);
      toast({ message: s("imported", { count: added.length }), severity: "success" });
    } catch (err) {
      failed(err);
    }
  };

  const nameOf = (kind: SendKind) => s(`kinds.${kind}`);
  // The kinds by group, each under its heading: printers, webhooks, the user's own.
  const addItems: React.ReactNode[] = [];
  for (const group of SEND_GROUPS) {
    addItems.push(
      <ListSubheader key={group} sx={{ lineHeight: "30px" }}>
        {s(`groups.${group}`)}
      </ListSubheader>,
    );
    for (const kind of Object.keys(SEND_KINDS) as SendKind[]) {
      if (SEND_KINDS[kind].group !== group) continue;
      addItems.push(
        <MenuItem key={kind} onClick={() => add(kind)} sx={{ gap: 1.5 }}>
          <SendKindIcon kind={kind} size={28} />
          <ListItemText primary={nameOf(kind)} secondary={s(`hints.${kind}`)} sx={{ my: 0 }} />
        </MenuItem>,
      );
    }
  }
  const subline = (target: SendTarget) =>
    [nameOf(kindOfHow(target.how)), whereOf(target), target.file_types.map((type) => `.${type}`).join(" ")]
      .filter(Boolean)
      .join(" · ");

  return (
    <Box>
      <PanelHeader
        title={s("title")}
        subtitle={s("subtitle")}
        action={
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              endIcon={<ArrowDropDownIcon />}
              onClick={(e) => setAddAnchor(e.currentTarget)}
              aria-haspopup="menu"
            >
              {s("add")}
            </Button>
            <Tooltip title={s("more")}>
              <IconButton
                size="small"
                aria-label={s("more")}
                aria-haspopup="menu"
                onClick={(e) => setMoreAnchor(e.currentTarget)}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />

      <Menu anchorEl={addAnchor} open={Boolean(addAnchor)} onClose={() => setAddAnchor(null)}>
        {addItems}
      </Menu>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null);
            fileInput.current?.click();
          }}
        >
          <ListItemIcon>
            <FileUploadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{s("import")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => void exportAll()} disabled={!targets?.length}>
          <ListItemIcon>
            <FileDownloadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText secondary={s("exportHint")}>{s("export")}</ListItemText>
        </MenuItem>
      </Menu>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />

      <Stack spacing={1}>
        <Collapse in={Boolean(adding)} unmountOnExit>
          {adding && (
            <Paper variant="outlined" sx={{ p: 1.5, borderColor: "primary.main" }}>
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.25 }}>
                <SendKindIcon kind={adding} />
                <Typography fontWeight={600} sx={{ color: (theme) => theme.thingport.headingText }}>
                  {nameOf(adding)}
                </Typography>
              </Stack>
              <SendTargetEditor
                key={adding}
                target={null}
                kind={adding}
                defaultName={nameOf(adding)}
                onCancel={() => setAdding(null)}
                onSaved={(saved) => {
                  setAdding(null);
                  changed((list) => [...list, saved]);
                }}
                onUnauthorized={onUnauthorized}
              />
            </Paper>
          )}
        </Collapse>

        {targets === null && <ListRowSkeletons count={3} leadSize={32} twoLines />}

        {targets?.length === 0 && !adding && (
          <Stack alignItems="center" spacing={1} sx={{ py: 5, textAlign: "center" }}>
            <SendOutlinedIcon sx={{ fontSize: 36, color: "text.secondary" }} />
            <Typography fontWeight={600} sx={{ color: (theme) => theme.thingport.headingText }}>
              {s("emptyTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
              {s("emptyHint")}
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={(e) => setAddAnchor(e.currentTarget)}>
              {s("add")}
            </Button>
          </Stack>
        )}

        {targets?.map((target) => {
          const kind = kindOfHow(target.how);
          const open = editing === target.id;
          const needsKey = SEND_KINDS[kind].apiKey === "required" && !target.secrets.api_key;
          return (
            <Paper
              key={target.id}
              variant="outlined"
              sx={{
                p: 1.25,
                borderColor: open ? "primary.main" : "divider",
                transition: (theme) => theme.transitions.create("border-color", { duration: 150 }),
                animation: `${rowIn} 180ms ease-out`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Box
                  component="button"
                  type="button"
                  onClick={() => {
                    setAdding(null);
                    setEditing(open ? null : target.id);
                  }}
                  aria-expanded={open}
                  sx={{
                    all: "unset",
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    cursor: "pointer",
                    borderRadius: 1,
                    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
                  }}
                >
                  <SendKindIcon kind={kind} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap fontWeight={600} sx={{ color: (theme) => theme.thingport.headingText }}>
                      {target.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color={needsKey ? "warning.main" : "text.secondary"}
                      noWrap
                      component="div"
                    >
                      {needsKey ? s("needsKey") : subline(target)}
                    </Typography>
                  </Box>
                </Box>
                <Segmented
                  label={s("placementLabel", { name: target.name })}
                  value={target.placement}
                  onChange={(placement) => void place(target, placement)}
                  options={[
                    { value: "button", label: s("placement.button") },
                    { value: "menu", label: s("placement.menu") },
                  ]}
                />
                <Tooltip title={s("more")}>
                  <IconButton
                    size="small"
                    aria-label={s("moreFor", { name: target.name })}
                    aria-haspopup="menu"
                    onClick={(e) => setRowMenu({ anchor: e.currentTarget, target })}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Collapse in={open} unmountOnExit>
                <Box sx={{ pt: 1.5 }}>
                  <SendTargetEditor
                    target={target}
                    kind={kind}
                    defaultName={target.name}
                    onCancel={() => setEditing(null)}
                    onSaved={(saved) => {
                      setEditing(null);
                      changed(replaced(saved, "settings"));
                      toast({ message: s("saved", { name: saved.name }), severity: "success" });
                    }}
                    onUnauthorized={onUnauthorized}
                  />
                </Box>
              </Collapse>
            </Paper>
          );
        })}
      </Stack>

      <Menu anchorEl={rowMenu?.anchor} open={Boolean(rowMenu)} onClose={() => setRowMenu(null)}>
        <MenuItem
          onClick={() => {
            if (rowMenu) setEditing(rowMenu.target.id);
            setAdding(null);
            setRowMenu(null);
          }}
        >
          <ListItemIcon>
            <EditOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{s("edit")}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => rowMenu && void remove(rowMenu.target)} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{s("delete")}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
