import { createContext, useContext, useEffect } from "react";
import type React from "react";

export type PageHeader = {
  title?: string;
  /** Shown smaller, under the title (see TopBar) -- the entity kind ("Collection", "Tag",
   *  "Model") for a detail page, so that context doesn't have to be spelled out as a
   *  "Collection: " prefix baked into the title text itself, competing with the name for the
   *  same line's limited width. */
  subtitle?: string;
  actions?: React.ReactNode;
  onBack?: () => void;
} | null;

/** Default no-op setter so usePageHeader is a harmless no-op for any page rendered outside
 *  AppLayout (e.g. tests) rather than throwing. */
export const PageHeaderContext = createContext<(header: PageHeader) => void>(() => {});

/** Lets a routed page override the shared TopBar's title/actions/back-target for as long as
 *  it's mounted -- cleared automatically on unmount so the next route falls back to its own
 *  default chrome (see AppLayout's useRouteChrome). Pass `undefined` fields while data is still
 *  loading, or to fall back to the route's default -- e.g. ModelsPage only overrides `onBack`
 *  while a category filter is active, so clicking back clears it instead of leaving the page. */
export function usePageHeader(header: PageHeader) {
  const setHeader = useContext(PageHeaderContext);
  const title = header?.title;
  const subtitle = header?.subtitle;
  const actions = header?.actions;
  const onBack = header?.onBack;
  useEffect(() => {
    setHeader({ title, subtitle, actions, onBack });
    return () => setHeader(null);
    // title/subtitle/actions/onBack are the only meaningful inputs; setHeader is stable from
    // AppLayout's state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle, actions, onBack]);
}
