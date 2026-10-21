import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CodeBlock from "../CodeBlock";
import Segmented from "../controls/Segmented";

type Client = "claudeCode" | "claude" | "chatgpt" | "codex" | "editors";
const CLIENTS: Client[] = ["claudeCode", "claude", "chatgpt", "codex", "editors"];
const TOKEN = "tp_your_token";
const GUIDE_URL = "https://github.com/TautvydasDerzinskas/Thingport/blob/main/docs/guides/mcp.md";

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
`;

/** The commands and settings each client needs, with this instance's address filled in. */
function snippets(endpoint: string) {
  return {
    claudeCode: `claude mcp add --transport http thingport ${endpoint} --header "Authorization: Bearer ${TOKEN}"`,
    remote: `${endpoint}\nAuthorization: Bearer ${TOKEN}`,
    codex: `export THINGPORT_TOKEN=${TOKEN}\ncodex mcp add thingport --url ${endpoint} --bearer-token-env-var THINGPORT_TOKEN`,
    cursor: JSON.stringify(
      { mcpServers: { thingport: { url: endpoint, headers: { Authorization: `Bearer ${TOKEN}` } } } },
      null,
      2,
    ),
    vscode: JSON.stringify(
      { servers: { thingport: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${TOKEN}` } } } },
      null,
      2,
    ),
  };
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" component="div">
      {children}
    </Typography>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
      {children}
    </Typography>
  );
}

type Props = { open: boolean; onClose: () => void };

/** How to point Claude, ChatGPT, Codex and editors at this instance's /api/mcp with an API token. */
export default function McpConnectDialog({ open, onClose }: Props) {
  const { t } = useTranslation("app");
  const [client, setClient] = React.useState<Client>("claudeCode");
  const endpoint = `${window.location.origin}/api/mcp`;
  const code = snippets(endpoint);
  const k = (key: string) => `mcpConnect.${key}`;
  const strong = { strong: <strong /> };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="mcp-connect-title">
      <DialogTitle id="mcp-connect-title" sx={{ pr: 6 }}>
        {t(k("title"))}
        <IconButton
          aria-label={t("mcpConnect.close")}
          onClick={onClose}
          size="small"
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            <Trans t={t} i18nKey={k("intro")} values={{ token: TOKEN }} components={{ ...strong, code: <code /> }} />
          </Typography>
          <Segmented<Client>
            label={t(k("clientLabel"))}
            value={client}
            onChange={setClient}
            options={CLIENTS.map((value) => ({ value, label: t(k(`clients.${value}`)) }))}
          />
          <Stack
            key={client}
            spacing={1.25}
            sx={{
              animation: `${fadeIn} 180ms ease-out both`,
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
          >
            {client === "claudeCode" && (
              <>
                <Step>{t(k("claudeCode.step"))}</Step>
                <CodeBlock code={code.claudeCode} />
              </>
            )}
            {client === "claude" && (
              <>
                <Step>
                  <Trans t={t} i18nKey={k("claude.step")} components={strong} />
                </Step>
                <CodeBlock code={code.remote} />
                <Note>{t(k("claude.note"))}</Note>
              </>
            )}
            {client === "chatgpt" && (
              <>
                <Step>
                  <Trans t={t} i18nKey={k("chatgpt.step")} components={strong} />
                </Step>
                <CodeBlock code={code.remote} />
                <Note>{t(k("chatgpt.note"))}</Note>
              </>
            )}
            {client === "codex" && (
              <>
                <Step>{t(k("codex.step"))}</Step>
                <CodeBlock code={code.codex} />
                <Note>{t(k("codex.note"))}</Note>
              </>
            )}
            {client === "editors" && (
              <>
                <Step>
                  <Trans t={t} i18nKey={k("editors.cursor")} components={{ code: <code /> }} />
                </Step>
                <CodeBlock code={code.cursor} />
                <Step>
                  <Trans t={t} i18nKey={k("editors.vscode")} components={{ code: <code /> }} />
                </Step>
                <CodeBlock code={code.vscode} />
                <Note>{t(k("editors.note"))}</Note>
              </>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3, pb: 2 }}>
        <Link
          href={GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
          underline="hover"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
        >
          {t(k("guide"))}
          <OpenInNewIcon sx={{ fontSize: 14 }} />
        </Link>
        <Button onClick={onClose}>{t(k("close"))}</Button>
      </DialogActions>
    </Dialog>
  );
}
