import type { ScaffoldContext } from "scaffold";

export default function (ctx: ScaffoldContext) {
  ctx.route("POST", "/api/tasks/:id/scramble-name", async (req, params) => {
    const row = ctx.db.query("SELECT * FROM tasks WHERE id = ?").get(params.id);
    if (!row) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const name = (row as any).name;
    const scrambled = name.split("").sort(() => Math.random() - 0.5).join("");
    ctx.db.run("UPDATE tasks SET name = ?, updated_at = datetime('now') WHERE id = ?", [scrambled, params.id]);
    const updated = ctx.db.query("SELECT * FROM tasks WHERE id = ?").get(params.id);
    return Response.json({ data: updated }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  });
}
