import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { copyText } from "../utils/clipboard";

/** A command or config to copy, in monospace, with a copy button. */
export default function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation("app");
  const box = React.useRef<HTMLPreElement>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  React.useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), copyState === "failed" ? 4000 : 1500);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  // Where the browser won't copy, the command is selected, to copy by hand.
  const copy = async () => {
    try {
      await copyText(code);
      setCopyState("copied");
    } catch {
      if (box.current) window.getSelection()?.selectAllChildren(box.current);
      setCopyState("failed");
    }
  };
  const copyLabel =
    copyState === "failed"
      ? t("codeBlock.copyFailed")
      : copyState === "copied"
        ? t("codeBlock.copied")
        : t("codeBlock.copy");
  return (
    <Box
      sx={{
        position: "relative",
        mt: 1,
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        bgcolor: "action.hover",
      }}
    >
      <Box
        component="pre"
        ref={box}
        sx={{
          m: 0,
          p: 1.25,
          pr: 5,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {code}
      </Box>
      <Tooltip title={copyLabel}>
        <IconButton
          size="small"
          aria-label={t("codeBlock.copy")}
          onClick={() => void copy()}
          sx={{ position: "absolute", top: 4, right: 4 }}
        >
          {copyState === "copied" ? (
            <CheckIcon sx={{ fontSize: 16 }} color="success" />
          ) : (
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </Tooltip>
    </Box>
  );
}
