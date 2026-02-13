import type { RouteEntry } from "./types";

export function createRouter() {
  const routes: RouteEntry[] = [];

  function add(method: string, pattern: string, handler: RouteEntry["handler"]) {
    const segments = pattern.split("/").filter(Boolean);
    routes.push({ method, pattern, segments, handler });
  }

  function match(method: string, pathname: string): { handler: RouteEntry["handler"]; params: Record<string, string> } | null {
    const pathSegments = pathname.split("/").filter(Boolean).map(s => decodeURIComponent(s));

    for (const route of routes) {
      if (route.method !== method && route.method !== "*") continue;
      if (route.segments.length !== pathSegments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = pathSegments[i];
        } else if (seg !== pathSegments[i]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { handler: route.handler, params };
      }
    }

    return null;
  }

  return { add, match, routes };
}
