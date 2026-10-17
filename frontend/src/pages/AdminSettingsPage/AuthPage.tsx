import React from "react";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import PublicUrlSection from "./PublicUrlSection";
import RegistrationsSection from "./RegistrationsSection";
import SessionSection from "./SessionSection";
import SignInMethodsSection from "./SignInMethodsSection";

type Props = {
  onUnauthorized?: () => void;
};

/** Where Thingport lives, who can join, how people sign in, and how long they stay signed in. */
export default function AuthPage({ onUnauthorized }: Props) {
  // Sign-in methods depend on the public URL (redirect URIs, whether a provider can be added): reloaded with it.
  const [publicUrlVersion, setPublicUrlVersion] = React.useState(0);
  return (
    <Stack spacing={4} divider={<Divider />}>
      <PublicUrlSection onSaved={() => setPublicUrlVersion((version) => version + 1)} onUnauthorized={onUnauthorized} />
      <RegistrationsSection onUnauthorized={onUnauthorized} />
      <SignInMethodsSection key={publicUrlVersion} onUnauthorized={onUnauthorized} />
      <SessionSection onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
