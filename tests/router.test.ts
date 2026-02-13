import { describe, test, expect } from "bun:test";
import { createRouter } from "../src/router";

describe("router", () => {
  test("matches static routes", () => {
    const router = createRouter();
    router.add("GET", "/api/users", () => new Response("ok"));

    const result = router.match("GET", "/api/users");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({});
  });

  test("matches parameterized routes", () => {
    const router = createRouter();
    router.add("GET", "/api/users/:id", () => new Response("ok"));

    const result = router.match("GET", "/api/users/42");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ id: "42" });
  });

  test("returns null for non-matching method", () => {
    const router = createRouter();
    router.add("POST", "/api/users", () => new Response("ok"));

    const result = router.match("GET", "/api/users");
    expect(result).toBeNull();
  });

  test("returns null for non-matching path", () => {
    const router = createRouter();
    router.add("GET", "/api/users", () => new Response("ok"));

    const result = router.match("GET", "/api/posts");
    expect(result).toBeNull();
  });

  test("matches first route on ambiguity", () => {
    const router = createRouter();
    let matched = "";
    router.add("GET", "/api/users/:id", () => { matched = "param"; return new Response("ok"); });
    router.add("GET", "/api/users/:slug", () => { matched = "slug"; return new Response("ok"); });

    const result = router.match("GET", "/api/users/42");
    expect(result).not.toBeNull();
    result!.handler(new Request("http://localhost/"), result!.params);
    expect(matched).toBe("param");
  });

  test("does not match different segment counts", () => {
    const router = createRouter();
    router.add("GET", "/api/users", () => new Response("ok"));

    expect(router.match("GET", "/api/users/42")).toBeNull();
    expect(router.match("GET", "/api")).toBeNull();
  });

  test("decodes percent-encoded path segments in params", () => {
    const router = createRouter();
    router.add("GET", "/api/components/:category/:name", () => new Response("ok"));

    const result = router.match("GET", "/api/components/uncategorized/stat%20card");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ category: "uncategorized", name: "stat card" });
  });

  test("decodes percent-encoded path segments in static matching", () => {
    const router = createRouter();
    router.add("GET", "/api/hello world", () => new Response("ok"));

    const result = router.match("GET", "/api/hello%20world");
    expect(result).not.toBeNull();
  });
});
