import { useEffect, useState } from "react";

// Minimal hash router — two routes, zero dependencies, zero deploy config.
// Hash routing means "/api/*" serverless paths are untouched and the static
// host needs no SPA rewrite rules.

export type Route = "/" | "/face";

function current(): Route {
  const h = window.location.hash.replace(/^#/, "");
  return h === "/face" ? "/face" : "/";
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
