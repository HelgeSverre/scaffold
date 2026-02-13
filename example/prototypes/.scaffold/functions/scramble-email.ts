import type { ScaffoldContext } from "scaffold";

export default function (ctx: ScaffoldContext) {
  ctx.route("POST", "/api/participants/:id/scramble-email", async (req, params) => {
    const row = ctx.db.query("SELECT id, email FROM participants WHERE id = ?").get(params.id);
    if (!row) {
      return Response.json({ error: { message: "Not found", status: 404 } }, { status: 404 });
    }

    const [local, domain] = (row as any).email.split("@");
    const scrambled = local.split("").sort(() => Math.random() - 0.5).join("");
    const newEmail = `${scrambled}@${domain}`;

    ctx.db.run(
      "UPDATE participants SET email = ?, updated_at = datetime('now') WHERE id = ?",
      [newEmail, params.id]
    );

    const updated = ctx.db.query("SELECT * FROM participants WHERE id = ?").get(params.id);
    return Response.json({ data: updated }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  });
}
