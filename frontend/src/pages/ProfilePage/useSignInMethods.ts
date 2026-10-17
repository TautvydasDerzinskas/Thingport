import React from "react";
import { UnauthorizedError } from "../../api/client";
import { oidcApi, type ProfileSignIn } from "../../api/oidc";

/** The user's password and single sign-on connections; null while loading or if it couldn't load. */
export function useSignInMethods(onUnauthorized?: () => void) {
  const [info, setInfo] = React.useState<ProfileSignIn | null>(null);
  const reload = React.useCallback(() => {
    oidcApi.profile().then(setInfo, (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
    });
  }, [onUnauthorized]);
  React.useEffect(reload, [reload]);
  return { info, reload };
}

/** What a round trip to a provider came back with, from this page's #fragment; read once, then cleared. */
export function useSsoResult(): { connected: string | null; error: string | null } {
  const [result] = React.useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    return { connected: fragment.get("sso_connected"), error: fragment.get("sso_error") };
  });
  React.useEffect(() => {
    if (result.connected || result.error) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, [result]);
  return result;
}
