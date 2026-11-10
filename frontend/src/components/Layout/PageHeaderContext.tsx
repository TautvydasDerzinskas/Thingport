import { createContext, useContext, useEffect } from "react";
import type React from "react";

export type PageHeader = {
  title?: string;
  /** The entity kind, shown under the title; an element (memoized, like `actions`) where it's more than words. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  onBack?: () => void;
} | null;

/** No-op default for pages rendered outside AppLayout (e.g. tests). */
export const PageHeaderContext = createContext<(header: PageHeader) => void>(() => {});

/** Overrides the TopBar while mounted. `undefined` fields fall back to the route's default. */
export function usePageHeader(header: PageHeader) {
  const setHeader = useContext(PageHeaderContext);
  const title = header?.title;
  const subtitle = header?.subtitle;
  const actions = header?.actions;
  const onBack = header?.onBack;
  useEffect(() => {
    setHeader({ title, subtitle, actions, onBack });
    return () => setHeader(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle, actions, onBack]);
}
