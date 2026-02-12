import { describe, test, expect } from "bun:test";
import { parseSchema, deriveEntityMeta } from "../src/schema";

const SAMPLE_YAML = `
name: Test App
entities:
  User:
    properties:
      - name
      - { name: email, type: email, nullable: true }
      - { name: role, type: enum, values: [admin, user], default: user }
      - { name: age, type: integer, nullable: true }

  Post:
    properties:
      - { name: user_id, type: relation, entity: User }
      - title
      - { name: body, type: text }
      - { name: published, type: boolean, default: false }
    seed:
      - { title: "Hello World", body: "First post", user_id: 1 }

  PostTag:
    pivot: true
    properties:
      - { name: post_id, type: relation, entity: Post }
      - { name: tag_id, type: relation, entity: Tag }
`;

describe("parseSchema", () => {
  test("parses entity names", () => {
    const config = parseSchema(SAMPLE_YAML);
    expect(Object.keys(config.entities)).toEqual(["User", "Post", "PostTag"]);
  });

  test("normalizes bare string properties", () => {
    const config = parseSchema(SAMPLE_YAML);
    const nameCol = config.entities.User.properties[0];
    expect(nameCol).toEqual({ name: "name", type: "string" });
  });

  test("parses full property definitions", () => {
    const config = parseSchema(SAMPLE_YAML);
    const emailCol = config.entities.User.properties[1];
    expect(emailCol).toEqual({ name: "email", type: "email", nullable: true });
  });

  test("parses enum with values", () => {
    const config = parseSchema(SAMPLE_YAML);
    const roleCol = config.entities.User.properties[2];
    expect(roleCol.type).toBe("enum");
    expect(roleCol.values).toEqual(["admin", "user"]);
    expect(roleCol.default).toBe("user");
  });

  test("parses pivot flag", () => {
    const config = parseSchema(SAMPLE_YAML);
    expect(config.entities.PostTag.pivot).toBe(true);
    expect(config.entities.User.pivot).toBe(false);
  });

  test("parses seed data", () => {
    const config = parseSchema(SAMPLE_YAML);
    expect(config.entities.Post.seed).toHaveLength(1);
    expect(config.entities.Post.seed![0].title).toBe("Hello World");
  });

  test("handles empty entities", () => {
    const config = parseSchema("name: Empty\n");
    expect(config.entities).toEqual({});
  });
});

describe("deriveEntityMeta", () => {
  test("derives table names in snake_case with s suffix", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    const names = metas.map((m) => m.tableName);
    expect(names).toEqual(["users", "posts", "post_tags"]);
  });

  test("derives route paths lowercased with s suffix", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    const paths = metas.map((m) => m.routePath);
    expect(paths).toEqual(["users", "posts", "posttags"]);
  });

  test("extracts relations", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    const postMeta = metas.find((m) => m.entityName === "Post")!;
    expect(postMeta.relations).toEqual([
      { property: "user_id", targetEntity: "User", targetTable: "users" },
    ]);
  });

  test("extracts pivot relations", () => {
    const config = parseSchema(SAMPLE_YAML);
    const metas = deriveEntityMeta(config);
    const pivotMeta = metas.find((m) => m.entityName === "PostTag")!;
    expect(pivotMeta.pivot).toBe(true);
    expect(pivotMeta.relations).toHaveLength(2);
  });
});
