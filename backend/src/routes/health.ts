import cors from "cors";
import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../db";
import { getAllowRegistrations, getEmailPasswordEnabled, isSmtpConfigured } from "../services/settingsService";
import { enabledProvidersForSignIn } from "../services/oidcService";

const router = Router();

// Any origin may read it: Thingport Grab checks what an instance offers before it has permission to reach it.
router.get(
  "/health",
  cors({ origin: "*" }),
  asyncHandler(async (_req, res) => {
    // The first admin can always register, whatever the setting says.
    const bootstrapping = (await prisma.user.count({ where: { role: "ADMIN" } })) === 0;
    // A sign-in method may be enabled just before another is removed.
    const { emailPasswordEnabled, oidcProviders } = await prisma.$transaction(
      async (tx) => ({
        emailPasswordEnabled: await getEmailPasswordEnabled(tx),
        oidcProviders: await enabledProvidersForSignIn(tx),
      }),
      { isolationLevel: "RepeatableRead" },
    );
    res.json({
      ok: true,
      auth_required: true,
      allow_registrations: bootstrapping || (await getAllowRegistrations(true)),
      email_password_enabled: emailPasswordEnabled,
      // The reset link is emailed, so the sign-in form only offers it with SMTP set up.
      password_reset_enabled: emailPasswordEnabled && (await isSmtpConfigured()),
      // The sign-in form's "Continue with ..." buttons.
      oidc_providers: oidcProviders,
      // Thingport Grab can connect by approval here instead of with a password.
      grab_pairing: true,
      // Everyone has an import queue here, and imports can join its line with ?queue=1.
      import_queue: true,
    });
  }),
);

export default router;
