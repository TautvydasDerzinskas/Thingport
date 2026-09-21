import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { UnauthorizedError } from "../../api/client";
import { adminApi, type AdminUser, type LogAction, type LogEntry } from "../../api/admin";

type Props = {
  onUnauthorized?: () => void;
};

type ActionColor = "success" | "error" | "info" | "warning" | "default";

const ACTION_COLORS: Record<LogAction, ActionColor> = {
  user_logged_in: "success",
  user_logged_out: "default",
  model_uploaded: "info",
  model_imported: "info",
  import_completed: "info",
  model_edited: "warning",
  model_deleted: "error",
  collection_created: "success",
  collection_edited: "warning",
  collection_deleted: "error",
  collection_item_added: "info",
  collection_item_removed: "default",
};

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return isoDateOnly(d);
}

/** Admin-only audit-trail viewer -- logins/logouts, uploads, imports, model edits/deletes, and
 *  collection creates/edits/deletes/item adds/removes. Filters mirror the write side's granularity: one entry per
 *  action, not per file, so a batch import shows as a single "import completed" row (see
 *  services/importJobRunner.ts) rather than one row per model. */
export default function LogsPage({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [userId, setUserId] = React.useState("");
  const [from, setFrom] = React.useState(defaultFromDate());
  const [to, setTo] = React.useState("");

  React.useEffect(() => {
    adminApi.listUsers().then(setUsers).catch(() => undefined);
  }, []);

  const loadLogs = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.listLogs({
        userId: userId || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setLogs(result);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(t("adminSettings.logs.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [userId, from, to, onUnauthorized, t]);

  React.useEffect(() => { void loadLogs(); }, [loadLogs]);

  const formatDetails = (log: LogEntry): string => {
    const d = log.details;
    switch (log.action) {
      case "model_uploaded":
      case "model_imported":
      case "model_deleted":
      case "collection_created":
      case "collection_edited":
      case "collection_deleted":
      case "collection_item_added":
      case "collection_item_removed":
        return typeof d.name === "string" ? d.name : "";
      case "model_edited":
        return typeof d.field === "string" ? t("adminSettings.logs.editedField", { field: d.field }) : "";
      case "import_completed": {
        const provider = typeof d.provider === "string" ? d.provider : "";
        const label = typeof d.sourceLabel === "string" && d.sourceLabel ? d.sourceLabel : provider;
        const imported = typeof d.imported === "number" ? d.imported : 0;
        const failed = typeof d.failed === "number" ? d.failed : 0;
        return t("adminSettings.logs.importSummary", { label, imported, failed });
      }
      default:
        return "";
    }
  };

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="logs-user-select-label">{t("adminSettings.logs.userLabel")}</InputLabel>
            <Select
              labelId="logs-user-select-label"
              label={t("adminSettings.logs.userLabel")}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <MenuItem value="">{t("adminSettings.logs.allUsers")}</MenuItem>
              {users.map((u) => (
                <MenuItem key={u.id} value={u.id}>{u.display_name} ({u.email})</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            type="date"
            label={t("adminSettings.logs.fromLabel")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label={t("adminSettings.logs.toLabel")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
      </Paper>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={20} />
        </Stack>
      ) : logs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">{t("adminSettings.logs.empty")}</Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("adminSettings.logs.columnDate")}</TableCell>
                  <TableCell>{t("adminSettings.logs.columnUser")}</TableCell>
                  <TableCell>{t("adminSettings.logs.columnAction")}</TableCell>
                  <TableCell>{t("adminSettings.logs.columnDetails")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell>{new Date(log.created_at).toLocaleString(i18n.language)}</TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="body2">{log.user_display_name}</Typography>
                        <Typography variant="caption" color="text.secondary">{log.user_email}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={t(`adminSettings.logs.action.${log.action}`)}
                        size="small"
                        color={ACTION_COLORS[log.action] ?? "default"}
                      />
                    </TableCell>
                    <TableCell>{formatDetails(log)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Stack>
  );
}
