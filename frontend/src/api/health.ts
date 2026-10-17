import { apiBase } from "./client";
import type { SignInProvider } from "./oidc";

export type HealthInfo = {
  ok: boolean;
  auth_required: boolean;
  allow_registrations: boolean;
  password_reset_enabled: boolean;
  /** Single sign-on providers the sign-in form offers. */
  oidc_providers: SignInProvider[];
};

export const healthApi = {
  get: async (): Promise<HealthInfo | null> => {
    try {
      const res = await fetch(`${apiBase()}/health`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        ok: Boolean(data?.ok),
        auth_required: Boolean(data?.auth_required),
        allow_registrations: data?.allow_registrations !== false,
        password_reset_enabled: data?.password_reset_enabled === true,
        oidc_providers: Array.isArray(data?.oidc_providers) ? data.oidc_providers : [],
      };
    } catch {
      return null;
    }
  },
};
