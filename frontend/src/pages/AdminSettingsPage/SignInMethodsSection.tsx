import React from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import { UnauthorizedError } from "../../api/client";
import {
  oidcApi,
  type OidcAccountMatch,
  type OidcProvider,
  type OidcSettings,
  type OidcTestOutcome,
  type OidcProviderInput,
} from "../../api/oidc";
import { useConfirm } from "../../components/ConfirmProvider";
import SectionHeader from "../../components/SectionHeader";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import UnlockAnimation from "../../components/authAnimations/UnlockAnimation";
import OidcProviderDialog from "./OidcProviderDialog";

type Props = {
  onUnauthorized?: () => void;
};

const TEST_POLL_MS = 1000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** How people sign in: email and password, plus any single sign-on (OIDC) providers. */
export default function SignInMethodsSection({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const [settings, setSettings] = React.useState<OidcSettings | null>(null);
  const [editing, setEditing] = React.useState<OidcProvider | "new" | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ severity: "success" | "error" | "info"; text: string } | null>(null);
  const [test, setTest] = React.useState<{ provider: OidcProvider; outcome: OidcTestOutcome | "closed" } | null>(null);
  const testRun = React.useRef(0);
  const settingsRequest = React.useRef(0);
  const settingsMutationInFlight = React.useRef(false);

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setNotice({ severity: "error", text: err instanceof Error ? err.message : String(err) });
    },
    [onUnauthorized],
  );

  const load = React.useCallback(() => {
    const request = ++settingsRequest.current;
    oidcApi.get().then(
      (nextSettings) => {
        if (request === settingsRequest.current) setSettings(nextSettings);
      },
      (err) => {
        if (request === settingsRequest.current) fail(err);
      },
    );
  }, [fail]);
  React.useEffect(load, [load]);
  // A test still polling stops when the page goes.
  React.useEffect(
    () => () => {
      testRun.current += 1;
    },
    [],
  );

  const publicUrl = settings?.public_url ?? null;
  // The provider sends people back to PUBLIC_URL; a sign-in started at another address can't finish there.
  const elsewhere = publicUrl !== null && new URL(publicUrl).origin !== window.location.origin;

  const setEnabled = async (provider: OidcProvider, enabled: boolean) => {
    if (
      !enabled &&
      settings &&
      !settings.email_password_enabled &&
      settings.providers.filter((each) => each.enabled).length === 1
    ) {
      return;
    }
    if (!enabled && provider.user_count > 0) {
      const ok = await confirm({
        title: t("adminSettings.signIn.disableTitle", { name: provider.name }),
        message:
          settings?.email_password_enabled === false
            ? t("adminSettings.signIn.disableMessageOidcOnly", { name: provider.name, count: provider.user_count })
            : t("adminSettings.signIn.disableMessage", { name: provider.name, count: provider.user_count }),
        confirmLabel: t("adminSettings.signIn.disableConfirm"),
        destructive: true,
      });
      if (!ok) return;
    }
    if (settingsMutationInFlight.current) return;
    settingsMutationInFlight.current = true;
    setBusy(provider.id);
    setNotice(null);
    try {
      await oidcApi.update(provider.id, { enabled });
      load();
    } catch (err) {
      fail(err);
    } finally {
      settingsMutationInFlight.current = false;
      setBusy(null);
    }
  };

  const setEmailPasswordEnabled = async (enabled: boolean) => {
    if (!enabled) {
      const ok = await confirm({
        title: t("adminSettings.signIn.disablePasswordTitle"),
        message: t("adminSettings.signIn.disablePasswordMessage"),
        confirmLabel: t("adminSettings.signIn.disablePasswordConfirm"),
        destructive: true,
      });
      if (!ok) return;
    }
    if (settingsMutationInFlight.current) return;
    settingsMutationInFlight.current = true;
    setBusy("email-password");
    setNotice(null);
    try {
      const updatedSettings = await oidcApi.setEmailPasswordEnabled(enabled);
      settingsRequest.current += 1;
      setSettings(updatedSettings);
    } catch (err) {
      fail(err);
    } finally {
      settingsMutationInFlight.current = false;
      setBusy(null);
    }
  };

  const saveProvider = async (
    provider: OidcProvider | null,
    input: OidcProviderInput,
  ): Promise<OidcProvider | null> => {
    if (settingsMutationInFlight.current) return null;
    settingsMutationInFlight.current = true;
    setBusy("provider");
    setNotice(null);
    try {
      return provider ? await oidcApi.update(provider.id, input) : await oidcApi.create(input);
    } finally {
      settingsMutationInFlight.current = false;
      setBusy(null);
    }
  };

  const remove = async (provider: OidcProvider) => {
    if (
      settings &&
      !settings.email_password_enabled &&
      provider.enabled &&
      settings.providers.filter((each) => each.enabled).length === 1
    ) {
      return;
    }
    const ok = await confirm({
      title: t("adminSettings.signIn.deleteTitle", { name: provider.name }),
      message:
        provider.user_count > 0
          ? settings?.email_password_enabled === false
            ? t("adminSettings.signIn.deleteUsedMessageOidcOnly", { name: provider.name, count: provider.user_count })
            : t("adminSettings.signIn.deleteUsedMessage", { name: provider.name, count: provider.user_count })
          : t("adminSettings.signIn.deleteMessage", { name: provider.name }),
      confirmLabel: t("adminSettings.signIn.delete"),
      destructive: true,
    });
    if (!ok) return;
    if (settingsMutationInFlight.current) return;
    settingsMutationInFlight.current = true;
    setBusy(`delete-${provider.id}`);
    setNotice(null);
    try {
      await oidcApi.remove(provider.id);
      load();
    } catch (err) {
      fail(err);
    } finally {
      settingsMutationInFlight.current = false;
      setBusy(null);
    }
  };

  const runTest = async (provider: OidcProvider) => {
    setNotice(null);
    // Opened in the click itself, so a popup blocker lets it through; it's pointed at the provider once that's known.
    const popup = window.open("", "thingport-oidc-test", "width=520,height=720");
    const run = ++testRun.current;
    setTest({ provider, outcome: { status: "waiting" } });
    try {
      const { url, test_id: testId } = await oidcApi.startTest(provider.id);
      if (popup) popup.location.href = url;
      else window.open(url, "thingport-oidc-test", "width=520,height=720");
      // Until the callback records what came back, or the window is closed without finishing.
      let closedPolls = 0;
      while (testRun.current === run) {
        await new Promise((resolve) => window.setTimeout(resolve, TEST_POLL_MS));
        if (testRun.current !== run) return;
        const outcome = await oidcApi.testOutcome(testId);
        if (outcome.status === "done") {
          setTest({ provider, outcome });
          return;
        }
        // The callback may land a moment after the window closes.
        closedPolls = popup?.closed ? closedPolls + 1 : 0;
        if (closedPolls >= 2) {
          setTest({ provider, outcome: "closed" });
          return;
        }
      }
    } catch (err) {
      popup?.close();
      setTest(null);
      fail(err);
    }
  };

  const closeTest = () => {
    testRun.current += 1;
    setTest(null);
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.signIn.heading")} subtitle={t("adminSettings.signIn.subtitle")} />

      {settings && elsewhere && settings.providers.length > 0 && (
        <Alert severity="info">{t("adminSettings.signIn.otherAddress", { url: publicUrl })}</Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="flex-start">
          <AnimatedTile>
            <UnlockAnimation size={76} />
          </AnimatedTile>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <Paper variant="outlined" sx={{ borderRadius: "12px", overflow: "hidden" }}>
              <MethodRow
                icon={<LockOutlinedIcon />}
                title={t("adminSettings.signIn.password")}
                description={
                  settings
                    ? settings.email_password_enabled
                      ? t("adminSettings.signIn.passwordDescription")
                      : t("adminSettings.signIn.passwordDisabledDescription")
                    : ""
                }
                actions={
                  settings ? (
                    <Tooltip
                      title={
                        !settings.email_password_enabled ||
                        (settings.public_url && settings.providers.some((provider) => provider.enabled))
                          ? ""
                          : t("adminSettings.signIn.passwordNeedsOidc")
                      }
                    >
                      <span>
                        <Switch
                          checked={settings.email_password_enabled}
                          disabled={
                            busy !== null ||
                            (settings.email_password_enabled &&
                              (!settings.public_url || !settings.providers.some((provider) => provider.enabled)))
                          }
                          onChange={(event) => void setEmailPasswordEnabled(event.target.checked)}
                          slotProps={{
                            input: { "aria-label": t("adminSettings.signIn.password") },
                          }}
                        />
                      </span>
                    </Tooltip>
                  ) : (
                    <Skeleton variant="rounded" width={74} height={32} />
                  )
                }
              />
              {settings === null ? (
                <Box sx={{ px: 2, py: 1.5 }}>
                  <Skeleton width="60%" />
                </Box>
              ) : (
                settings.providers.map((provider) => {
                  const lastEnabledProvider =
                    !settings.email_password_enabled &&
                    provider.enabled &&
                    settings.providers.filter((each) => each.enabled).length === 1;
                  return (
                    <MethodRow
                      key={provider.id}
                      icon={<KeyOutlinedIcon />}
                      dim={!provider.enabled}
                      title={provider.name}
                      description={[
                        hostOf(provider.issuer_url),
                        t("adminSettings.signIn.userCount", { count: provider.user_count }),
                        provider.create_accounts ? t("adminSettings.signIn.createsAccounts") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      actions={
                        <>
                          <Tooltip title={t("adminSettings.signIn.test")}>
                            <span>
                              <IconButton
                                aria-label={t("adminSettings.signIn.test")}
                                disabled={!publicUrl || test !== null}
                                onClick={() => void runTest(provider)}
                              >
                                <NetworkCheckIcon />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={t("adminSettings.signIn.edit")}>
                            <IconButton
                              aria-label={t("adminSettings.signIn.edit")}
                              disabled={busy !== null}
                              onClick={() => setEditing(provider)}
                            >
                              <EditOutlinedIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip
                            title={
                              lastEnabledProvider
                                ? t("adminSettings.signIn.keepOidcEnabled")
                                : t("adminSettings.signIn.delete")
                            }
                          >
                            <span>
                              <IconButton
                                aria-label={t("adminSettings.signIn.delete")}
                                disabled={busy !== null || lastEnabledProvider}
                                onClick={() => void remove(provider)}
                              >
                                <DeleteOutlineIcon />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip
                            title={
                              lastEnabledProvider
                                ? t("adminSettings.signIn.keepOidcEnabled")
                                : t("adminSettings.signIn.showOnSignIn", { name: provider.name })
                            }
                          >
                            <span>
                              <Switch
                                checked={provider.enabled}
                                disabled={busy !== null || lastEnabledProvider}
                                onChange={(event) => void setEnabled(provider, event.target.checked)}
                                slotProps={{
                                  input: {
                                    "aria-label": t("adminSettings.signIn.showOnSignIn", { name: provider.name }),
                                  },
                                }}
                              />
                            </span>
                          </Tooltip>
                        </>
                      }
                    />
                  );
                })
              )}
            </Paper>

            <Box>
              {/* Without the public URL a provider has nowhere to send people back to. */}
              <Tooltip title={settings && !publicUrl ? t("adminSettings.signIn.publicUrlMissing") : ""}>
                <span>
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    disabled={!publicUrl || busy !== null}
                    onClick={() => setEditing("new")}
                  >
                    {t("adminSettings.signIn.add")}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Stack>
        </Stack>
      </Paper>

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {editing && (
        <OidcProviderDialog
          key={editing === "new" ? "new" : editing.id}
          provider={editing === "new" ? null : editing}
          publicUrl={publicUrl}
          saveBlocked={busy !== null}
          onClose={() => setEditing(null)}
          onSave={saveProvider}
          onSaved={(saved, added) => {
            setEditing(null);
            load();
            if (added) {
              setNotice({
                severity: "info",
                text: t(saved.enabled ? "adminSettings.signIn.addedOn" : "adminSettings.signIn.addedOff", {
                  name: saved.name,
                }),
              });
            }
          }}
          onUnauthorized={onUnauthorized}
        />
      )}

      {test && <TestDialog provider={test.provider} outcome={test.outcome} onClose={closeTest} />}
    </Stack>
  );
}

function MethodRow({
  icon,
  title,
  description,
  actions,
  dim = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 1, sm: 2 }}
      alignItems={{ xs: "stretch", sm: "center" }}
      sx={{ px: 2, py: 1.5, "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" } }}
    >
      <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ flexShrink: 0, display: "flex", color: "text.secondary", opacity: dim ? 0.45 : 1 }}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body1" fontWeight={600} sx={{ opacity: dim ? 0.6 : 1 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {description}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" alignItems="center" justifyContent="flex-end" sx={{ flexShrink: 0 }}>
        {actions}
      </Stack>
    </Stack>
  );
}

function matchText(match: OidcAccountMatch, t: TFunction<["app", "common"]>): string {
  switch (match.action) {
    case "sign_in":
      return t("adminSettings.signIn.matchSignIn", { name: match.user.display_name, email: match.user.email });
    case "link":
      return t("adminSettings.signIn.matchLink", { name: match.user.display_name, email: match.user.email });
    case "create":
      return t("adminSettings.signIn.matchCreate", { email: match.email });
    default:
      return t("adminSettings.signIn.matchRefuse", { reason: match.reason });
  }
}

/** What a test sign-in came back with: the provider's claims, and whom they'd sign in as. */
function TestDialog({
  provider,
  outcome,
  onClose,
}: {
  provider: OidcProvider;
  outcome: OidcTestOutcome | "closed";
  onClose: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const waiting = outcome !== "closed" && outcome.status === "waiting";
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("adminSettings.signIn.testTitle", { name: provider.name })}</DialogTitle>
      <DialogContent>
        {waiting ? (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              {t("adminSettings.signIn.testWaiting", { name: provider.name })}
            </Typography>
          </Stack>
        ) : outcome === "closed" ? (
          <Alert severity="warning">{t("adminSettings.signIn.testClosed")}</Alert>
        ) : outcome.status === "done" && !outcome.ok ? (
          <Alert severity="error">{t("adminSettings.signIn.testFailed", { error: outcome.error })}</Alert>
        ) : outcome.status === "done" && outcome.ok ? (
          <Stack spacing={2}>
            <Alert severity={outcome.match.action === "refuse" ? "warning" : "success"}>
              {matchText(outcome.match, t)}
            </Alert>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("adminSettings.signIn.claims")}
              </Typography>
              <Box
                component="dl"
                sx={{
                  m: 0,
                  display: "grid",
                  gridTemplateColumns: "minmax(110px, max-content) 1fr",
                  columnGap: 2,
                  rowGap: 0.5,
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  "& dt": { color: "text.secondary" },
                  "& dd": { m: 0, overflowWrap: "anywhere" },
                }}
              >
                {Object.entries(outcome.claims).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt>{key}</dt>
                    <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                  </React.Fragment>
                ))}
              </Box>
            </Box>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{waiting ? t("common:cancel") : t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
