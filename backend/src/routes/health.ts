import cors from "cors";
import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../db";
import { getAllowRegistrations, isSmtpConfigured } from "../services/settingsService";
import { enabledProvidersForSignIn } from "../services/oidcService";

const router = Router();

// Any origin may read it: Thingport Grab checks what an instance offers before it has permission to reach it.
router.get(
  "/health",
  cors({ origin: "*" }),
  asyncHandler(async (_req, res) => {
    // The first admin can always register, whatever the setting says.
    const bootstrapping = (await prisma.user.count({ where: { role: "ADMIN" } })) === 0;
    res.json({
      ok: true,
      auth_required: true,
      allow_registrations: bootstrapping || (await getAllowRegistrations(true)),
      // The reset link is emailed, so the sign-in form only offers it with SMTP set up.
      password_reset_enabled: await isSmtpConfigured(),
      // The sign-in form's "Continue with ..." buttons.
      oidc_providers: await enabledProvidersForSignIn(),
      // Thingport Grab can connect by approval here instead of with a password.
      grab_pairing: true,
    });
  }),
);

export default router;
