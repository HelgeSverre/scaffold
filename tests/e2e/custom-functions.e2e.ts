import { test, expect } from "@playwright/test";

test.describe("Custom functions", () => {
  test("POST /api/tasks/:id/scramble-name scrambles the task name", async ({ request }) => {
    // Get the first task to know its original name
    const before = await request.get("/api/tasks/1").then(r => r.json());
    const originalName = before.data.name;

    // Call the custom function
    const res = await request.post("/api/tasks/1/scramble-name");
    expect(res.status()).toBe(200);
    const body = await res.json();

    // The scrambled name should have the same characters but (likely) different order
    expect(body.data.name.length).toBe(originalName.length);
    expect(body.data.name.split("").sort().join("")).toBe(originalName.split("").sort().join(""));
  });

  test("POST /api/tasks/999/scramble-name returns 404 for non-existent task", async ({ request }) => {
    const res = await request.post("/api/tasks/999/scramble-name");
    expect(res.status()).toBe(404);
  });
});
