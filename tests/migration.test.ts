import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { parseSchema, deriveEntityMeta } from "../src/schema";
import { migrate, seed } from "../src/migration";

const SAMPLE_YAML = `
name: Test
entities:
  Category:
    properties:
      - name
      - { name: sort_order, type: integer, default: 0 }
    seed:
      - { name: "First", sort_order: 0 }
      - { name: "Second", sort_order: 1 }

  Item:
    properties:
      - { name: category_id, type: relation, entity: Category }
      - name
      - { name: quantity, type: integer, nullable: true }
      - { name: is_active, type: boolean, default: true }
      - { name: price, type: number, nullable: true }
      - { name: uuid, type: uuid }
      - { name: config, type: json, nullable: true }

  ItemTag:
    pivot: true
    properties:
      - { name: item_id, type: relation, entity: Item }
      - { name: tag_id, type: integer }
`;

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
});

describe("migrate", () => {
  test("creates tables for all entities", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("categorys");
    expect(names).toContain("items");
    expect(names).toContain("item_tags");
  });

  test("creates correct columns for regular entity", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    const cols = db.query("PRAGMA table_info('items')").all() as { name: string; type: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("category_id");
    expect(colNames).toContain("name");
    expect(colNames).toContain("quantity");
    expect(colNames).toContain("is_active");
    expect(colNames).toContain("price");
    expect(colNames).toContain("uuid");
    expect(colNames).toContain("config");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");
  });

  test("creates correct column types", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    const cols = db.query("PRAGMA table_info('items')").all() as { name: string; type: string }[];
    const colMap = Object.fromEntries(cols.map((c) => [c.name, c.type]));
    expect(colMap.category_id).toBe("INTEGER");
    expect(colMap.name).toBe("TEXT");
    expect(colMap.quantity).toBe("INTEGER");
    expect(colMap.is_active).toBe("INTEGER");
    expect(colMap.price).toBe("REAL");
    expect(colMap.uuid).toBe("TEXT");
    expect(colMap.config).toBe("TEXT");
  });

  test("pivot tables have no timestamps", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    const cols = db.query("PRAGMA table_info('item_tags')").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain("created_at");
    expect(colNames).not.toContain("updated_at");
    expect(colNames).toContain("id");
    expect(colNames).toContain("item_id");
    expect(colNames).toContain("tag_id");
  });

  test("pivot tables have unique index", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='item_tags'")
      .all() as { name: string }[];
    const idxNames = indexes.map((i) => i.name);
    expect(idxNames).toContain("idx_item_tags_unique");
  });

  test("adds missing columns on re-run", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    // Add a new property and re-migrate
    const itemMeta = metas.find((m) => m.entityName === "Item")!;
    itemMeta.properties.push({ name: "new_col", type: "string" });
    migrate(db, metas);

    const cols = db.query("PRAGMA table_info('items')").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("new_col");
  });

  test("re-run is idempotent", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);
    // Should not throw
    migrate(db, metas);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThanOrEqual(3);
  });
});

describe("seed", () => {
  test("inserts seed data into empty tables", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);
    seed(db, metas);

    const rows = db.query("SELECT * FROM categorys").all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("First");
    expect(rows[0].sort_order).toBe(0);
    expect(rows[1].name).toBe("Second");
    expect(rows[1].sort_order).toBe(1);
  });

  test("sets timestamps on seeded rows", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);
    seed(db, metas);

    const row = db.query("SELECT * FROM categorys LIMIT 1").get() as any;
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });

  test("does not duplicate seed on re-run", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);
    seed(db, metas);
    seed(db, metas);

    const rows = db.query("SELECT * FROM categorys").all() as any[];
    expect(rows).toHaveLength(2);
  });

  test("auto-generates UUIDs for uuid columns", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    // Manually seed an item to test UUID generation
    const itemMeta = metas.find((m) => m.entityName === "Item")!;
    itemMeta.seed = [{ name: "Test", category_id: 1, is_active: true }];
    seed(db, metas);

    const row = db.query("SELECT * FROM items LIMIT 1").get() as any;
    expect(row.uuid).toMatch(/^[0-9a-f]{8}-/);
  });

  test("coerces boolean values in seed", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    migrate(db, metas);

    const itemMeta = metas.find((m) => m.entityName === "Item")!;
    itemMeta.seed = [{ name: "Test", category_id: 1, is_active: true }];
    seed(db, metas);

    const row = db.query("SELECT * FROM items LIMIT 1").get() as any;
    expect(row.is_active).toBe(1);
  });
});
