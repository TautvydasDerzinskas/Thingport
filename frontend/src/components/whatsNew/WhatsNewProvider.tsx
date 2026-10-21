import React from "react";
import { useSearchParams } from "react-router-dom";
import WhatsNewDialog, { type WhatsNewRequest } from "./WhatsNewDialog";

type OpenWhatsNew = (request?: Partial<WhatsNewRequest>) => void;

const WhatsNewContext = React.createContext<OpenWhatsNew | null>(null);

/** One What's new dialog for the app. The update notification opens it with "?whats-new=<version>&since=<old>",
 *  which works on any page and is taken off the URL once read, so going back doesn't reopen it. */
export function WhatsNewProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<WhatsNewRequest | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  React.useEffect(() => {
    const version = searchParams.get("whats-new");
    if (version === null) return;
    setRequest({ version: version || null, since: searchParams.get("since") });
    const rest = new URLSearchParams(searchParams);
    rest.delete("whats-new");
    rest.delete("since");
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);

  const open = React.useCallback<OpenWhatsNew>(
    (next) => setRequest({ version: next?.version ?? null, since: next?.since ?? null }),
    [],
  );

  return (
    <WhatsNewContext.Provider value={open}>
      {children}
      <WhatsNewDialog request={request} onClose={() => setRequest(null)} />
    </WhatsNewContext.Provider>
  );
}

/** Opens What's new; this instance's version unless told another. A no-op outside the provider. */
export function useWhatsNew(): OpenWhatsNew {
  return React.useContext(WhatsNewContext) ?? (() => undefined);
}
