import type { Database } from "bun:sqlite";
import type { EntityMeta, PropertyDef } from "./types";

function sqlType(prop: PropertyDef): string {
  switch (prop.type) {
    case "integer":
    case "relation":
    case "boolean":
      return "INTEGER";
    case "number":
      return "REAL";
    default:
      return "TEXT";
  }
}

function columnDefault(prop: PropertyDef): string {
  if (prop.default === undefined) return "";
  if (prop.type === "boolean") {
    return ` DEFAULT ${prop.default ? 1 : 0}`;
  }
  if (typeof prop.default === "number") {
    return ` DEFAULT ${prop.default}`;
  }
  return ` DEFAULT '${String(prop.default).replace(/'/g, "''")}'`;
}

function getExistingTables(db: Database): Set<string> {
  const rows = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function getExistingColumns(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info('${table}')`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

export function migrate(db: Database, entities: EntityMeta[]) {
  const existingTables = getExistingTables(db);

  for (const entity of entities) {
    if (existingTables.has(entity.tableName)) {
      addMissingColumns(db, entity);
    } else {
      createTable(db, entity);
    }
  }
}

function createTable(db: Database, entity: EntityMeta) {
  const columns: string[] = [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
  ];

  for (const prop of entity.properties) {
    let col = `${prop.name} ${sqlType(prop)}`;
    if (!prop.nullable && prop.default === undefined && prop.type !== "uuid") {
      // Don't add NOT NULL for uuid (auto-generated) or nullable fields
    }
    col += columnDefault(prop);
    columns.push(col);
  }

  if (!entity.pivot) {
    columns.push("created_at TEXT");
    columns.push("updated_at TEXT");
  }

  const sql = `CREATE TABLE ${entity.tableName} (\n  ${columns.join(",\n  ")}\n)`;
  db.run(sql);

  // Pivot tables get a unique index on all relation columns
  if (entity.pivot) {
    const relationCols = entity.properties
      .filter((p) => p.type === "relation")
      .map((p) => p.name);
    if (relationCols.length > 0) {
      db.run(
        `CREATE UNIQUE INDEX idx_${entity.tableName}_unique ON ${entity.tableName} (${relationCols.join(", ")})`
      );
    }
  }
}

function addMissingColumns(db: Database, entity: EntityMeta) {
  const existingCols = getExistingColumns(db, entity.tableName);

  for (const prop of entity.properties) {
    if (!existingCols.has(prop.name)) {
      let col = `${prop.name} ${sqlType(prop)}`;
      col += columnDefault(prop);
      db.run(`ALTER TABLE ${entity.tableName} ADD COLUMN ${col}`);
    }
  }

  if (!entity.pivot) {
    if (!existingCols.has("created_at")) {
      db.run(`ALTER TABLE ${entity.tableName} ADD COLUMN created_at TEXT`);
    }
    if (!existingCols.has("updated_at")) {
      db.run(`ALTER TABLE ${entity.tableName} ADD COLUMN updated_at TEXT`);
    }
  }
}

export function seed(db: Database, entities: EntityMeta[]) {
  for (const entity of entities) {
    if (!entity.seed || entity.seed.length === 0) continue;

    const count = db.query(`SELECT COUNT(*) as c FROM ${entity.tableName}`).get() as { c: number };
    if (count.c > 0) continue;

    for (const row of entity.seed) {
      insertSeedRow(db, entity, row);
    }
  }
}

function insertSeedRow(db: Database, entity: EntityMeta, row: Record<string, any>) {
  const now = new Date().toISOString();
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: any[] = [];

  for (const prop of entity.properties) {
    let value = row[prop.name];

    if (value === undefined) {
      // Auto-generate UUID
      if (prop.type === "uuid") {
        value = crypto.randomUUID();
      } else if (prop.default !== undefined) {
        value = prop.default;
      } else if (prop.nullable) {
        value = null;
      } else {
        continue;
      }
    }

    // Coerce types
    if (prop.type === "boolean") {
      value = value === true || value === "true" || value === 1 ? 1 : 0;
    } else if (prop.type === "json" && typeof value !== "string") {
      value = JSON.stringify(value);
    }

    columns.push(prop.name);
    placeholders.push("?");
    values.push(value);
  }

  // Add timestamps for non-pivot tables
  if (!entity.pivot) {
    columns.push("created_at", "updated_at");
    placeholders.push("?", "?");
    values.push(now, now);
  }

  const sql = `INSERT INTO ${entity.tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
  db.run(sql, values);
}
