import type { ServerWebSocket } from "bun";

interface WSData {
  page: string | null;
}

export function createWSManager() {
  const connections = new Map<string, Set<ServerWebSocket<WSData>>>();

  function join(ws: ServerWebSocket<WSData>, page: string) {
    ws.data.page = page;
    if (!connections.has(page)) {
      connections.set(page, new Set());
    }
    connections.get(page)!.add(ws);
    broadcastViewerCount(page);
  }

  function leave(ws: ServerWebSocket<WSData>) {
    const page = ws.data.page;
    if (page && connections.has(page)) {
      connections.get(page)!.delete(ws);
      if (connections.get(page)!.size === 0) {
        connections.delete(page);
      } else {
        broadcastViewerCount(page);
      }
    }
  }

  function broadcast(page: string, message: object) {
    const clients = connections.get(page);
    if (!clients) return;
    const payload = JSON.stringify(message);
    for (const ws of clients) {
      ws.send(payload);
    }
  }

  function broadcastViewerCount(page: string) {
    const count = connections.get(page)?.size || 0;
    broadcast(page, { type: "viewers", page, count });
  }

  function handleMessage(ws: ServerWebSocket<WSData>, message: string) {
    try {
      const msg = JSON.parse(message);
      if (msg.type === "join" && msg.page) {
        // Leave previous page if any
        leave(ws);
        join(ws, msg.page);
      } else if (msg.type === "leave") {
        leave(ws);
      }
    } catch {
      // Ignore invalid messages
    }
  }

  function handleClose(ws: ServerWebSocket<WSData>) {
    leave(ws);
  }

  return { join, leave, broadcast, handleMessage, handleClose, connections };
}
