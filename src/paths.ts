import { join } from "path";

/** Resolve a path within the project's .scaffold directory */
export function scaffoldPath(dir: string, ...segments: string[]): string {
  return join(dir, ".scaffold", ...segments);
}
