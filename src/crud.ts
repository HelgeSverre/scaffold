import type { Database } from "bun:sqlite";
import type { EntityMeta, PropertyDef } from "./types";

type Router = {
  add: (method: string, pattern: string, handler: (req: Request, params: Record<string, string>) => Response | Promise<Response>) => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(data: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...headers,
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { message, status } }, status);
}

function validColumnName(name: string, allowed: Set<string>): boolean {
  return allowed.has(name);
}

export function registerCrudRoutes(router: Router, db: Database, entities: EntityMeta[]) {
  // Build entity lookup for eager loading
  const entityByTable = new Map<string, EntityMeta>();
  const entityByRoute = new Map<string, EntityMeta>();
  for (const e of entities) {
    entityByTable.set(e.tableName, e);
    entityByRoute.set(e.routePath, e);
  }

  for (const entity of entities) {
    const base = `/api/${entity.routePath}`;
    const allColumns = new Set(["id", ...entity.properties.map((p) => p.name)]);
    if (!entity.pivot) {
      allColumns.add("created_at");
      allColumns.add("updated_at");
    }

    // OPTIONS preflight
    router.add("OPTIONS", base, () => jsonResponse(null, 204));
    router.add("OPTIONS", `${base}/:id`, () => jsonResponse(null, 204));

    // GET list
    router.add("GET", base, (req) => {
      const url = new URL(req.url);
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
      const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") || "25")));
      const offset = (page - 1) * perPage;

      // Sorting
      let orderClause = "id ASC";
      const sortParam = url.searchParams.get("sort");
      if (sortParam) {
        const desc = sortParam.startsWith("-");
        const sortField = desc ? sortParam.slice(1) : sortParam;
        if (validColumnName(sortField, allColumns)) {
          orderClause = `${sortField} ${desc ? "DESC" : "ASC"}`;
        }
      }

      // Filtering
      const whereClauses: string[] = [];
      const whereValues: any[] = [];

      for (const [key, value] of url.searchParams) {
        if (["page", "per_page", "sort", "with"].includes(key)) continue;

        if (key.endsWith("_like")) {
          const field = key.slice(0, -5);
          if (validColumnName(field, allColumns)) {
            whereClauses.push(`${field} LIKE ?`);
            whereValues.push(value);
          }
        } else if (key.endsWith("_gt")) {
          const field = key.slice(0, -3);
          if (validColumnName(field, allColumns)) {
            whereClauses.push(`${field} > ?`);
            whereValues.push(value);
          }
        } else if (key.endsWith("_lt")) {
          const field = key.slice(0, -3);
          if (validColumnName(field, allColumns)) {
            whereClauses.push(`${field} < ?`);
            whereValues.push(value);
          }
        } else if (key.endsWith("_gte")) {
          const field = key.slice(0, -4);
          if (validColumnName(field, allColumns)) {
            whereClauses.push(`${field} >= ?`);
            whereValues.push(value);
          }
        } else if (key.endsWith("_lte")) {
          const field = key.slice(0, -4);
          if (validColumnName(field, allColumns)) {
            whereClauses.push(`${field} <= ?`);
            whereValues.push(value);
          }
        } else if (key.endsWith("_null")) {
          const field = key.slice(0, -5);
          if (validColumnName(field, allColumns)) {
            if (value === "true") {
              whereClauses.push(`${field} IS NULL`);
            } else {
              whereClauses.push(`${field} IS NOT NULL`);
            }
          }
        } else if (validColumnName(key, allColumns)) {
          whereClauses.push(`${key} = ?`);
          whereValues.push(value);
        }
      }

      const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const countRow = db.query(`SELECT COUNT(*) as total FROM ${entity.tableName} ${whereSQL}`).get(...whereValues) as { total: number };
      const total = countRow.total;
      const lastPage = Math.max(1, Math.ceil(total / perPage));

      const rows = db.query(
        `SELECT * FROM ${entity.tableName} ${whereSQL} ORDER BY ${orderClause} LIMIT ? OFFSET ?`
      ).all(...whereValues, perPage, offset) as Record<string, any>[];

      const data = rows.map((r) => deserializeRow(r, entity));

      // Eager loading
      const withParam = url.searchParams.get("with");
      if (withParam && data.length > 0) {
        eagerLoad(db, data, entity, withParam, entityByTable, entityByRoute);
      }

      return jsonResponse({
        data,
        meta: { total, page, per_page: perPage, last_page: lastPage },
      });
    });

    // GET single
    router.add("GET", `${base}/:id`, (req, params) => {
      const row = db.query(`SELECT * FROM ${entity.tableName} WHERE id = ?`).get(params.id) as Record<string, any> | null;
      if (!row) return errorResponse("Not found", 404);

      const data = deserializeRow(row, entity);

      const url = new URL(req.url);
      const withParam = url.searchParams.get("with");
      if (withParam) {
        eagerLoad(db, [data], entity, withParam, entityByTable, entityByRoute);
      }

      return jsonResponse({ data });
    });

    // POST create
    router.add("POST", base, async (req) => {
      let body: Record<string, any>;
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body", 400);
      }

      const validationError = validateFields(db, body, entity, false, entityByTable);
      if (validationError) return errorResponse(validationError, 422);

      const now = new Date().toISOString();
      const columns: string[] = [];
      const placeholders: string[] = [];
      const values: any[] = [];

      for (const prop of entity.properties) {
        let value = body[prop.name];

        if (value === undefined) {
          if (prop.type === "uuid") {
            value = crypto.randomUUID();
          } else if (prop.default !== undefined) {
            continue; // Let SQLite handle the default
          } else if (prop.nullable) {
            continue;
          } else {
            continue;
          }
        }

        value = coerceValue(value, prop);
        columns.push(prop.name);
        placeholders.push("?");
        values.push(value);
      }

      if (!entity.pivot) {
        columns.push("created_at", "updated_at");
        placeholders.push("?", "?");
        values.push(now, now);
      }

      const sql = `INSERT INTO ${entity.tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
      db.run(sql, values);

      const inserted = db.query(`SELECT * FROM ${entity.tableName} WHERE id = last_insert_rowid()`).get() as Record<string, any>;
      return jsonResponse({ data: deserializeRow(inserted, entity) }, 201);
    });

    // PUT full update
    router.add("PUT", `${base}/:id`, async (req, params) => {
      const existing = db.query(`SELECT * FROM ${entity.tableName} WHERE id = ?`).get(params.id);
      if (!existing) return errorResponse("Not found", 404);

      let body: Record<string, any>;
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body", 400);
      }

      const validationError = validateFields(db, body, entity, false, entityByTable);
      if (validationError) return errorResponse(validationError, 422);

      const sets: string[] = [];
      const values: any[] = [];

      for (const prop of entity.properties) {
        let value = body[prop.name];
        if (value === undefined) {
          if (prop.type === "uuid") continue; // Don't overwrite UUID
          if (prop.default !== undefined) {
            value = prop.default;
          } else if (prop.nullable) {
            value = null;
          } else {
            continue;
          }
        }
        value = coerceValue(value, prop);
        sets.push(`${prop.name} = ?`);
        values.push(value);
      }

      if (!entity.pivot) {
        sets.push("updated_at = ?");
        values.push(new Date().toISOString());
      }

      values.push(params.id);
      db.run(`UPDATE ${entity.tableName} SET ${sets.join(", ")} WHERE id = ?`, values);

      const updated = db.query(`SELECT * FROM ${entity.tableName} WHERE id = ?`).get(params.id) as Record<string, any>;
      return jsonResponse({ data: deserializeRow(updated, entity) });
    });

    // PATCH partial update
    router.add("PATCH", `${base}/:id`, async (req, params) => {
      const existing = db.query(`SELECT * FROM ${entity.tableName} WHERE id = ?`).get(params.id);
      if (!existing) return errorResponse("Not found", 404);

      let body: Record<string, any>;
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body", 400);
      }

      const validationError = validateFields(db, body, entity, true, entityByTable);
      if (validationError) return errorResponse(validationError, 422);

      const sets: string[] = [];
      const values: any[] = [];

      for (const [key, rawValue] of Object.entries(body)) {
        if (key === "id" || key === "created_at" || key === "updated_at") continue;
        const prop = entity.properties.find((p) => p.name === key);
        if (!prop) continue;
        const value = coerceValue(rawValue, prop);
        sets.push(`${key} = ?`);
        values.push(value);
      }

      if (sets.length === 0) return errorResponse("No valid fields to update", 400);

      if (!entity.pivot) {
        sets.push("updated_at = ?");
        values.push(new Date().toISOString());
      }

      values.push(params.id);
      db.run(`UPDATE ${entity.tableName} SET ${sets.join(", ")} WHERE id = ?`, values);

      const updated = db.query(`SELECT * FROM ${entity.tableName} WHERE id = ?`).get(params.id) as Record<string, any>;
      return jsonResponse({ data: deserializeRow(updated, entity) });
    });

    // DELETE
    router.add("DELETE", `${base}/:id`, (_req, params) => {
      const existing = db.query(`SELECT id FROM ${entity.tableName} WHERE id = ?`).get(params.id);
      if (!existing) return errorResponse("Not found", 404);

      db.run(`DELETE FROM ${entity.tableName} WHERE id = ?`, [params.id]);
      return jsonResponse({ data: { id: Number(params.id) } });
    });
  }
}

function coerceValue(value: any, prop: PropertyDef): any {
  if (value === null) return null;
  if (prop.type === "boolean") {
    return value === true || value === "true" || value === 1 ? 1 : 0;
  }
  if (prop.type === "json" && typeof value !== "string") {
    return JSON.stringify(value);
  }
  return value;
}

function deserializeRow(row: Record<string, any>, entity: EntityMeta): Record<string, any> {
  const result = { ...row };
  for (const prop of entity.properties) {
    if (prop.type === "json" && result[prop.name] !== null && result[prop.name] !== undefined) {
      try {
        result[prop.name] = JSON.parse(result[prop.name]);
      } catch {
        // Leave as string if parse fails
      }
    }
    if (prop.type === "boolean" && result[prop.name] !== null && result[prop.name] !== undefined) {
      result[prop.name] = result[prop.name] === 1 || result[prop.name] === true;
    }
  }
  return result;
}

function validateFields(
  db: Database,
  body: Record<string, any>,
  entity: EntityMeta,
  partial: boolean,
  entityByTable: Map<string, EntityMeta>
): string | null {
  for (const prop of entity.properties) {
    const value = body[prop.name];

    // Required check (non-partial only)
    if (!partial && value === undefined && !prop.nullable && prop.default === undefined && prop.type !== "uuid") {
      return `${prop.name} is required`;
    }

    if (value === undefined || value === null) continue;

    // Enum validation
    if (prop.type === "enum" && prop.values) {
      if (!prop.values.includes(value)) {
        return `${prop.name} must be one of: ${prop.values.join(", ")}`;
      }
    }

    // Email validation
    if (prop.type === "email" && typeof value === "string" && !EMAIL_RE.test(value)) {
      return `${prop.name} must be a valid email address`;
    }

    // JSON validation
    if (prop.type === "json" && typeof value === "string") {
      try {
        JSON.parse(value);
      } catch {
        return `${prop.name} must be valid JSON`;
      }
    }

    // Relation existence check
    if (prop.type === "relation" && prop.entity) {
      const targetMeta = Array.from(entityByTable.values()).find((e) => e.entityName === prop.entity);
      if (targetMeta) {
        const exists = db.query(`SELECT id FROM ${targetMeta.tableName} WHERE id = ?`).get(value);
        if (!exists) {
          return `${prop.name} references a non-existent ${prop.entity} (id: ${value})`;
        }
      }
    }
  }

  return null;
}

function eagerLoad(
  db: Database,
  rows: Record<string, any>[],
  entity: EntityMeta,
  withParam: string,
  entityByTable: Map<string, EntityMeta>,
  entityByRoute: Map<string, EntityMeta>
) {
  const requestedRelations = withParam.split(",").map((s) => s.trim());

  for (const relName of requestedRelations) {
    // Find the relation by a short name: strip _id suffix from property and match
    const relation = entity.relations.find((r) => {
      const shortName = r.property.replace(/_id$/, "");
      return shortName === relName;
    });
    if (!relation) continue;

    const targetMeta = Array.from(entityByTable.values()).find((e) => e.entityName === relation.targetEntity);
    if (!targetMeta) continue;

    // Collect FK IDs
    const fkIds = [...new Set(rows.map((r) => r[relation.property]).filter((id) => id != null))];
    if (fkIds.length === 0) continue;

    // Batch query
    const placeholders = fkIds.map(() => "?").join(", ");
    const related = db
      .query(`SELECT * FROM ${targetMeta.tableName} WHERE id IN (${placeholders})`)
      .all(...fkIds) as Record<string, any>[];

    const relatedMap = new Map(related.map((r) => [r.id, deserializeRow(r, targetMeta)]));

    // Attach to rows
    const shortName = relation.property.replace(/_id$/, "");
    for (const row of rows) {
      const fkId = row[relation.property];
      row[shortName] = fkId != null ? relatedMap.get(fkId) || null : null;
    }
  }
}
