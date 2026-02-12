import { watch } from "fs";
import { basename } from "path";

export function startWatcher(
  dir: string,
  broadcastFn: (page: string, msg: object) => void,
  recentlySaved: Set<string>
) {
  const debounceTimers = new Map<string, Timer>();

  const watcher = watch(dir, (event, filename) => {
    if (!filename || !filename.endsWith(".html")) return;

    const page = filename.replace(/\.html$/, "");

    // Skip if this file was just written by the save endpoint
    if (recentlySaved.has(page)) return;

    // Debounce: editors fire multiple events per save
    if (debounceTimers.has(page)) {
      clearTimeout(debounceTimers.get(page)!);
    }

    debounceTimers.set(
      page,
      setTimeout(() => {
        debounceTimers.delete(page);
        broadcastFn(page, { type: "reload", page });
      }, 100)
    );
  });

  return watcher;
}
