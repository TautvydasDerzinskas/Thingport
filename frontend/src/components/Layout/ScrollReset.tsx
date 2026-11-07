import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** BrowserRouter leaves the window where it was, so a new page opened as far down as the last one was scrolled.
 *  Only a new path resets: a query change (filters, sorting, an open dialog) stays put, and back/forward are left to
 *  the browser, which returns to where that page was. */
export default function ScrollReset() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const lastPathname = useRef(pathname);

  useLayoutEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    if (navigationType !== "POP") window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  return null;
}
