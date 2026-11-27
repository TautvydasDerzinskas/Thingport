import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en.json";
import ChangeEmailPage from "./ChangeEmailPage";
import { useSignInMethods } from "./useSignInMethods";

vi.mock("./useSignInMethods", () => ({
  useSignInMethods: vi.fn<typeof useSignInMethods>(),
  useSsoResult: () => ({ error: null }),
}));

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", resources: { en: { app: en.app } } });

function render(passwordAvailable: boolean, signedInRecently: boolean) {
  vi.mocked(useSignInMethods).mockReturnValue({
    info: {
      has_password: true,
      password_available: passwordAvailable,
      signed_in_recently: signedInRecently,
      can_connect: true,
      providers: [
        {
          slug: "example",
          name: "Example SSO",
          enabled: true,
          connection: { id: "connection", email: null, connected_at: "2026-01-01", last_used_at: null },
        },
      ],
    },
    reload: () => undefined,
  });

  return renderToStaticMarkup(
    <StaticRouter location="/profile/email">
      <I18nextProvider i18n={i18n}>
        <ChangeEmailPage user={null} onUserUpdated={() => undefined} />
      </I18nextProvider>
    </StaticRouter>,
  );
}

describe("changing email on an account with a stored password", () => {
  it("asks for the current password while password sign-in is enabled", () => {
    const html = render(true, false);
    expect(html).toMatch(/<input\b[^>]*type="password"/);
    expect(html).not.toContain("Example SSO");
  });

  it("offers OIDC confirmation for an older session when password sign-in is disabled", () => {
    const html = render(false, false);
    expect(html).toContain("Example SSO");
    expect(html).not.toMatch(/<input\b[^>]*type="password"/);
  });

  it("offers the email form without a password after confirmation", () => {
    const html = render(false, true);
    expect(html).toMatch(/<input\b[^>]*type="email"/);
    expect(html).not.toMatch(/<input\b[^>]*type="password"/);
    expect(html).not.toContain("Example SSO");
  });
});
