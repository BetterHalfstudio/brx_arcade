import { useEffect, useState } from "react";

// Minimal hash router — two routes, zero dependencies, zero deploy config.
// Hash routing means "/api/*" serverless paths are untouched and the static
// host needs no SPA rewrite rules.

export type Route = "/" | "/bg" | "/face";

function current(): Route {
  const h = window.location.hash.replace(/^#/, "");
  if (h === "/face") return "/face";
  if (h === "/bg") return "/bg";
  return "/";
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
