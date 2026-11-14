import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CodeBlock from "../../components/CodeBlock";
import HelpTip from "../../components/HelpTip";
import { THINGPORT_WEBSITE_URL } from "../../constants/website";
import { DEFAULT_NAMES, folderIsAbsolute, guessHost, guideCommands, guidePaths, type GuideNames } from "./dumpGuide";
import { k } from "./parts";

const GUIDE_URL = `${THINGPORT_WEBSITE_URL}docs/guides/migrate/#1-stop-the-old-instances-backend`;
const STEPS = ["dump", "storage", "bring", "mount"] as const;

type Props = {
  /** Where this instance's backend reads a migration from. */
  root: string;
  onClose: () => void;
  /** Fills the Source step with where the dump and the storage folder will be. */
  onUse: (paths: { dumpPath: string; folder: string }) => void;
};

/** How to make an old instance's dump and storage copy and bring them here, a step a page, with the commands filled
 *  in from the names given. For an instance on a release without Migrate, which can't be copied online. */
export default function DumpGuideDialog({ root, onClose, onUse }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  const [step, setStep] = React.useState(0);
  const [names, setNames] = React.useState<GuideNames>(() => ({
    ...DEFAULT_NAMES,
    host: guessHost(window.location.hostname),
  }));
  const commands = guideCommands(names, { root, comment: t(k("dumpGuide.keepVolumes")) });
  const last = step === STEPS.length - 1;
  const folderWrong = !folderIsAbsolute(names.folder);

  const field = (key: keyof GuideNames, label: string, help: string, error?: string) => (
    <TextField
      size="small"
      fullWidth
      label={
        <>
          {label}
          <HelpTip text={help} />
        </>
      }
      value={names[key]}
      onChange={(event) => setNames({ ...names, [key]: event.target.value })}
      placeholder={DEFAULT_NAMES[key]}
      error={Boolean(error)}
      helperText={error}
      slotProps={{
        htmlInput: { spellCheck: false, autoCapitalize: "off" },
        inputLabel: { shrink: true, sx: { pointerEvents: "auto" } },
      }}
    />
  );

  const lead = (key: string, values?: Record<string, string>) => (
    <Typography variant="body2" color="text.secondary">
      {t(k(`dumpGuide.${key}`), values)}
    </Typography>
  );

  let pane: React.ReactNode;
  if (step === 0) {
    pane = (
      <>
        {lead("dumpLead")}
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, pt: 1 }}>
          {field("user", t(k("dumpGuide.user")), t(k("dumpGuide.userHelp")))}
          {field("database", t(k("dumpGuide.database")), t(k("dumpGuide.databaseHelp")))}
        </Box>
        <CodeBlock code={commands.dump} />
      </>
    );
  } else if (step === 1) {
    pane = (
      <>
        {lead("storageLead")}
        <CodeBlock code={commands.storage} />
      </>
    );
  } else if (step === 2) {
    pane = (
      <>
        {lead("bringLead")}
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, pt: 1 }}>
          {field("host", t(k("dumpGuide.host")), t(k("dumpGuide.hostHelp")))}
          {field(
            "folder",
            t(k("dumpGuide.folder")),
            t(k("dumpGuide.folderHelp"), { root }),
            folderWrong ? t(k("dumpGuide.folderAbsolute"), { example: DEFAULT_NAMES.folder }) : undefined,
          )}
        </Box>
        <CodeBlock code={commands.bring} />
      </>
    );
  } else {
    pane = (
      <>
        {lead("mountLead")}
        <CodeBlock code={commands.mount} />
        <CodeBlock code={commands.restart} />
      </>
    );
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={phone} aria-labelledby="dump-guide-title">
      <DialogTitle
        id="dump-guide-title"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}
      >
        {t(k("dumpGuide.title"))}
        <Tooltip title={t("common:close")}>
          <IconButton size="small" onClick={onClose} aria-label={t("common:close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ minHeight: { sm: 340 } }}>
        <Stepper activeStep={step} alternativeLabel={!phone} sx={{ mb: 2.5, mt: 1 }}>
          {STEPS.map((name, index) => (
            <Step key={name} completed={index < step}>
              <StepLabel>{phone && index !== step ? "" : t(k(`dumpGuide.steps.${name}`))}</StepLabel>
            </Step>
          ))}
        </Stepper>
        <Box
          key={step}
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            "@keyframes dumpGuideStepIn": { from: { opacity: 0, transform: "translateX(8px)" }, to: { opacity: 1 } },
            animation: "dumpGuideStepIn 180ms ease-out",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          {pane}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          component="a"
          href={GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          size="small"
          endIcon={<OpenInNewIcon fontSize="small" />}
          sx={{ mr: "auto" }}
        >
          {t(k("dumpGuide.guide"))}
        </Button>
        {step > 0 ? (
          <Button onClick={() => setStep(step - 1)}>{t("common:back")}</Button>
        ) : (
          <Button onClick={onClose}>{t("common:close")}</Button>
        )}
        {last ? (
          <Button variant="contained" onClick={() => onUse(guidePaths(root))}>
            {t(k("dumpGuide.use"))}
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={STEPS[step] === "bring" && folderWrong}
            onClick={() => setStep(step + 1)}
          >
            {t(k("dialog.next"))}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
