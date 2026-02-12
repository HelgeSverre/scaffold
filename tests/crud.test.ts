import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { parseSchema, deriveEntityMeta } from "../src/schema";
import { migrate, seed } from "../src/migration";
import { createRouter } from "../src/router";
import { registerCrudRoutes } from "../src/crud";

const YAML = `
name: Test
entities:
  Category:
    properties:
      - name
      - { name: sort_order, type: integer, default: 0 }
    seed:
      - { name: "Alpha", sort_order: 0 }
      - { name: "Beta", sort_order: 1 }
      - { name: "Gamma", sort_order: 2 }

  Item:
    properties:
      - { name: category_id, type: relation, entity: Category }
      - name
      - { name: item_type, type: enum, values: [access, consumable, returnable] }
      - { name: quantity, type: integer, nullable: true }
      - { name: is_active, type: boolean, default: true }
      - { name: price, type: number, nullable: true }
      - { name: email, type: email, nullable: true }
      - { name: config, type: json, nullable: true }
      - { name: uuid, type: uuid }

  ItemTag:
    pivot: true
    properties:
      - { name: item_id, type: relation, entity: Item }
      - { name: tag_id, type: integer }
`;

let db: Database;
let router: ReturnType<typeof createRouter>;

async function req(method: string, path: string, body?: any): Promise<{ status: number; json: any }> {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const request = new Request(url, init);
  const match = router.match(method, new URL(url).pathname);
  if (!match) return { status: 404, json: { error: { message: "No route", status: 404 } } };
  const response = await match.handler(request, match.params);
  const json = response.status === 204 ? null : await response.json();
  return { status: response.status, json };
}

beforeEach(() => {
  db = new Database(":memory:");
  const config = parseSchema(YAML);
  const entities = deriveEntityMeta(config);
  migrate(db, entities);
  seed(db, entities);
  router = createRouter();
  registerCrudRoutes(router, db, entities);
});

describe("CRUD - List", () => {
  test("GET /api/categorys returns seeded data", async () => {
    const res = await req("GET", "/api/categorys");
    expect(res.status).toBe(200);
    expect(res.json.data).toHaveLength(3);
    expect(res.json.meta.total).toBe(3);
    expect(res.json.meta.page).toBe(1);
  });

  test("pagination works", async () => {
    const res = await req("GET", "/api/categorys?per_page=2&page=1");
    expect(res.json.data).toHaveLength(2);
    expect(res.json.meta.last_page).toBe(2);

    const res2 = await req("GET", "/api/categorys?per_page=2&page=2");
    expect(res2.json.data).toHaveLength(1);
  });

  test("sorting works", async () => {
    const res = await req("GET", "/api/categorys?sort=-sort_order");
    expect(res.json.data[0].name).toBe("Gamma");
    expect(res.json.data[2].name).toBe("Alpha");
  });

  test("exact filter works", async () => {
    const res = await req("GET", "/api/categorys?name=Beta");
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0].name).toBe("Beta");
  });

  test("like filter works", async () => {
    const res = await req("GET", "/api/categorys?name_like=%lpha");
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0].name).toBe("Alpha");
  });

  test("comparison filters work", async () => {
    const res = await req("GET", "/api/categorys?sort_order_gt=0");
    expect(res.json.data).toHaveLength(2);

    const res2 = await req("GET", "/api/categorys?sort_order_gte=1");
    expect(res2.json.data).toHaveLength(2);

    const res3 = await req("GET", "/api/categorys?sort_order_lt=2");
    expect(res3.json.data).toHaveLength(2);

    const res4 = await req("GET", "/api/categorys?sort_order_lte=0");
    expect(res4.json.data).toHaveLength(1);
  });

  test("null filter works", async () => {
    // Create an item with null quantity
    await req("POST", "/api/items", { name: "Test", category_id: 1, item_type: "access" });

    const res = await req("GET", "/api/items?quantity_null=true");
    expect(res.json.data.length).toBeGreaterThanOrEqual(1);
  });

  test("ignores invalid sort columns", async () => {
    const res = await req("GET", "/api/categorys?sort=nonexistent");
    expect(res.status).toBe(200); // Falls back to default sort
  });
});

describe("CRUD - Get One", () => {
  test("GET /api/categorys/1 returns single record", async () => {
    const res = await req("GET", "/api/categorys/1");
    expect(res.status).toBe(200);
    expect(res.json.data.name).toBe("Alpha");
  });

  test("returns 404 for non-existent ID", async () => {
    const res = await req("GET", "/api/categorys/999");
    expect(res.status).toBe(404);
  });
});

describe("CRUD - Create", () => {
  test("POST creates record and returns 201", async () => {
    const res = await req("POST", "/api/items", {
      name: "New Item",
      category_id: 1,
      item_type: "access",
    });
    expect(res.status).toBe(201);
    expect(res.json.data.name).toBe("New Item");
    expect(res.json.data.id).toBeDefined();
    expect(res.json.data.uuid).toMatch(/^[0-9a-f]{8}-/);
    expect(res.json.data.is_active).toBe(true); // default
    expect(res.json.data.created_at).toBeTruthy();
  });

  test("validates required fields", async () => {
    const res = await req("POST", "/api/items", { item_type: "access" });
    expect(res.status).toBe(422);
    expect(res.json.error.message).toContain("is required");
  });

  test("validates enum values", async () => {
    const res = await req("POST", "/api/items", {
      name: "Bad",
      category_id: 1,
      item_type: "invalid_type",
    });
    expect(res.status).toBe(422);
    expect(res.json.error.message).toContain("must be one of");
  });

  test("validates email format", async () => {
    const res = await req("POST", "/api/items", {
      name: "Bad",
      category_id: 1,
      item_type: "access",
      email: "not-an-email",
    });
    expect(res.status).toBe(422);
    expect(res.json.error.message).toContain("valid email");
  });

  test("validates relation existence", async () => {
    const res = await req("POST", "/api/items", {
      name: "Bad",
      category_id: 999,
      item_type: "access",
    });
    expect(res.status).toBe(422);
    expect(res.json.error.message).toContain("non-existent");
  });

  test("handles JSON fields", async () => {
    const res = await req("POST", "/api/items", {
      name: "Configured",
      category_id: 1,
      item_type: "access",
      config: { foo: "bar" },
    });
    expect(res.status).toBe(201);
    expect(res.json.data.config).toEqual({ foo: "bar" });
  });

  test("coerces boolean fields", async () => {
    const res = await req("POST", "/api/items", {
      name: "Active",
      category_id: 1,
      item_type: "access",
      is_active: false,
    });
    expect(res.status).toBe(201);
    expect(res.json.data.is_active).toBe(false);
  });

  test("rejects invalid JSON body", async () => {
    const request = new Request("http://localhost/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const match = router.match("POST", "/api/items")!;
    const response = await match.handler(request, match.params);
    expect(response.status).toBe(400);
  });
});

describe("CRUD - Update", () => {
  test("PUT updates all fields", async () => {
    // Create first
    const created = await req("POST", "/api/items", {
      name: "Original",
      category_id: 1,
      item_type: "access",
    });
    const id = created.json.data.id;

    const res = await req("PUT", `/api/items/${id}`, {
      name: "Updated",
      category_id: 1,
      item_type: "consumable",
    });
    expect(res.status).toBe(200);
    expect(res.json.data.name).toBe("Updated");
    expect(res.json.data.item_type).toBe("consumable");
  });

  test("PATCH updates only provided fields", async () => {
    const created = await req("POST", "/api/items", {
      name: "Original",
      category_id: 1,
      item_type: "access",
    });
    const id = created.json.data.id;

    const res = await req("PATCH", `/api/items/${id}`, { name: "Patched" });
    expect(res.status).toBe(200);
    expect(res.json.data.name).toBe("Patched");
    expect(res.json.data.item_type).toBe("access"); // unchanged
  });

  test("PUT returns 404 for non-existent", async () => {
    const res = await req("PUT", "/api/items/999", { name: "Nope" });
    expect(res.status).toBe(404);
  });

  test("PATCH returns 404 for non-existent", async () => {
    const res = await req("PATCH", "/api/items/999", { name: "Nope" });
    expect(res.status).toBe(404);
  });

  test("PATCH validates enum on partial update", async () => {
    const created = await req("POST", "/api/items", {
      name: "Test",
      category_id: 1,
      item_type: "access",
    });
    const id = created.json.data.id;

    const res = await req("PATCH", `/api/items/${id}`, { item_type: "invalid" });
    expect(res.status).toBe(422);
  });
});

describe("CRUD - Delete", () => {
  test("DELETE removes record", async () => {
    const created = await req("POST", "/api/items", {
      name: "ToDelete",
      category_id: 1,
      item_type: "access",
    });
    const id = created.json.data.id;

    const res = await req("DELETE", `/api/items/${id}`);
    expect(res.status).toBe(200);
    expect(res.json.data.id).toBe(id);

    const check = await req("GET", `/api/items/${id}`);
    expect(check.status).toBe(404);
  });

  test("DELETE returns 404 for non-existent", async () => {
    const res = await req("DELETE", "/api/items/999");
    expect(res.status).toBe(404);
  });
});

describe("CRUD - Eager Loading", () => {
  test("with parameter loads relations", async () => {
    // Create an item linked to category 1
    await req("POST", "/api/items", {
      name: "Linked",
      category_id: 1,
      item_type: "access",
    });

    const res = await req("GET", "/api/items?with=category");
    expect(res.status).toBe(200);
    const item = res.json.data.find((i: any) => i.name === "Linked");
    expect(item.category).toBeDefined();
    expect(item.category.name).toBe("Alpha");
  });

  test("with parameter on single record", async () => {
    const created = await req("POST", "/api/items", {
      name: "Single",
      category_id: 2,
      item_type: "consumable",
    });
    const id = created.json.data.id;

    const res = await req("GET", `/api/items/${id}?with=category`);
    expect(res.json.data.category.name).toBe("Beta");
  });
});

describe("CRUD - CORS", () => {
  test("responses include CORS headers", async () => {
    const request = new Request("http://localhost/api/categorys");
    const match = router.match("GET", "/api/categorys")!;
    const response = await match.handler(request, match.params);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("OPTIONS returns 204 with CORS headers", async () => {
    const request = new Request("http://localhost/api/categorys", { method: "OPTIONS" });
    const match = router.match("OPTIONS", "/api/categorys")!;
    const response = await match.handler(request, match.params);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
