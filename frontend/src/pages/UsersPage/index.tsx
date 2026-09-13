import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { UnauthorizedError } from "../../api/client";
import { adminApi, type AdminUser } from "../../api/admin";

type Props = {
  onUnauthorized?: () => void;
};

/** Admin-only, read-only roster of every account on the instance. Models/Collections are
 *  per-user counts; MakerWorld is a connected/not-connected flag (each user's own MakerWorld
 *  session cookie, saved server-side from Settings -> Imports -- see
 *  services/makerworldCookieService.ts). The "delete all models for a user" action lives on the
 *  Settings -> Triggers page, not here. */
export default function UsersPage({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await adminApi.listUsers();
        if (!cancelled) setUsers(result);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(t("adminSettings.users.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized, t]);

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={20} />
        </Stack>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("adminSettings.users.columnEmail")}</TableCell>
                  <TableCell>{t("adminSettings.users.columnCreated")}</TableCell>
                  <TableCell>{t("adminSettings.users.columnDisplayName")}</TableCell>
                  <TableCell>{t("adminSettings.users.columnRole")}</TableCell>
                  <TableCell align="right">{t("adminSettings.users.columnModels")}</TableCell>
                  <TableCell align="right">{t("adminSettings.users.columnCollections")}</TableCell>
                  <TableCell>{t("adminSettings.users.columnMakerworld")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{formatDate(u.created_at)}</TableCell>
                    <TableCell>{u.display_name}</TableCell>
                    <TableCell>
                      <Chip
                        label={u.role === "ADMIN" ? t("adminSettings.users.roleAdmin") : t("adminSettings.users.roleMember")}
                        size="small"
                        color={u.role === "ADMIN" ? "primary" : "default"}
                        variant={u.role === "ADMIN" ? "filled" : "outlined"}
                      />
                    </TableCell>
                    <TableCell align="right">{u.print_count}</TableCell>
                    <TableCell align="right">{u.collection_count}</TableCell>
                    <TableCell>
                      <Chip
                        label={u.makerworld_connected ? t("adminSettings.users.makerworldConnected") : t("adminSettings.users.makerworldNotConnected")}
                        size="small"
                        color={u.makerworld_connected ? "success" : "default"}
                        variant={u.makerworld_connected ? "filled" : "outlined"}
                      />
                    </TableCell>
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
