import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { UnauthorizedError } from "../../api/client";
import { adminApi, type AdminUser } from "../../api/admin";
import UserActionsMenu from "./UserActionsMenu";
import { TableRowSkeletons } from "../../components/ListSkeleton";

type Props = {
  onUnauthorized?: () => void;
};

/** Every account; admins promote, demote and delete from each row's menu. */
export default function UsersPage({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [reloads, setReloads] = React.useState(0);
  const reload = React.useCallback(() => setReloads((count) => count + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only the first load shows skeletons; a reload after a change keeps the table in place.
      if (reloads === 0) setLoading(true);
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
  }, [onUnauthorized, t, reloads]);

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);

  return (
    <Stack spacing={3}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("adminSettings.users.columnEmail")}</TableCell>
                <TableCell>{t("adminSettings.users.columnCreated")}</TableCell>
                <TableCell>{t("adminSettings.users.columnDisplayName")}</TableCell>
                <TableCell>{t("adminSettings.users.columnRole")}</TableCell>
                <TableCell>{t("adminSettings.users.columnSignIn")}</TableCell>
                <TableCell align="right">{t("adminSettings.users.columnModels")}</TableCell>
                <TableCell align="right">{t("adminSettings.users.columnCollections")}</TableCell>
                <TableCell>{t("adminSettings.users.columnMakerworld")}</TableCell>
                <TableCell padding="checkbox" aria-label={t("adminSettings.users.columnActions")} />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRowSkeletons rows={5} columns={9} />
              ) : (
                users.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{formatDate(u.created_at)}</TableCell>
                    <TableCell>{u.display_name}</TableCell>
                    <TableCell>
                      <Chip
                        label={
                          u.role === "ADMIN" ? t("adminSettings.users.roleAdmin") : t("adminSettings.users.roleMember")
                        }
                        size="small"
                        color={u.role === "ADMIN" ? "primary" : "default"}
                        variant={u.role === "ADMIN" ? "filled" : "outlined"}
                      />
                      {u.is_owner && (
                        <Chip
                          label={t("adminSettings.users.owner")}
                          size="small"
                          color="primary"
                          variant="outlined"
                          sx={{ ml: 0.75 }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <SignInChips signIn={u.sign_in} />
                    </TableCell>
                    <TableCell align="right">{u.print_count}</TableCell>
                    <TableCell align="right">{u.collection_count}</TableCell>
                    <TableCell>
                      <Chip
                        label={
                          u.makerworld_connected
                            ? t("adminSettings.users.makerworldConnected")
                            : t("adminSettings.users.makerworldNotConnected")
                        }
                        size="small"
                        color={u.makerworld_connected ? "success" : "default"}
                        variant={u.makerworld_connected ? "filled" : "outlined"}
                      />
                    </TableCell>
                    <TableCell padding="checkbox">
                      <UserActionsMenu user={u} onChanged={reload} onUnauthorized={onUnauthorized} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}

/** How someone signs in: a chip for their password and one per connected provider; a warning when nothing works. */
function SignInChips({ signIn }: { signIn: AdminUser["sign_in"] }) {
  const { t } = useTranslation("app");
  const working = signIn.password || signIn.providers.some((provider) => provider.enabled);
  return (
    <Stack direction="row" gap={0.75} flexWrap="wrap">
      {signIn.password && (
        <Chip
          icon={<LockOutlinedIcon />}
          label={t("adminSettings.users.signInPassword")}
          size="small"
          variant="outlined"
        />
      )}
      {signIn.providers.map((provider) => (
        <Tooltip
          key={provider.name}
          title={provider.enabled ? "" : t("adminSettings.users.signInProviderOff", { name: provider.name })}
        >
          <Chip
            icon={<KeyOutlinedIcon />}
            label={provider.name}
            size="small"
            variant="outlined"
            sx={provider.enabled ? undefined : { opacity: 0.55, textDecoration: "line-through" }}
          />
        </Tooltip>
      ))}
      {!working && (
        <Tooltip title={t("adminSettings.users.signInNoneHint")}>
          <Chip label={t("adminSettings.users.signInNone")} size="small" color="error" variant="outlined" />
        </Tooltip>
      )}
    </Stack>
  );
}
