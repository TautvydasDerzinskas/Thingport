/** Site-internal link: prefixes the base path (`/Thingport/` on GitHub Pages) to a route like
 *  `docs/install/`. Every internal link goes through this so a custom domain is a config change. */
export function url(route = ""): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return base + route.replace(/^\//, "");
}

export const formatDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
