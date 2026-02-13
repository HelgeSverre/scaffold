import { test, expect } from "@playwright/test";

test.describe("CRUD API integration", () => {
  test.describe.configure({ mode: "serial" });

  test("loads seeded tasks on page load", async ({ page }) => {
    await page.goto("/todo");
    await expect(page.getByTestId("task-item")).toHaveCount(3);
    await expect(page.getByTestId("task-count")).toContainText("3");
  });

  test("sorts tasks by name", async ({ page }) => {
    await page.goto("/todo");
    await page.getByTestId("sort-name").click();
    const first = page.getByTestId("task-item").first();
    await expect(first).toContainText("Buy groceries");
    // click again for descending
    await page.getByTestId("sort-name").click();
    await expect(page.getByTestId("task-item").first()).toContainText(
      "Write tests"
    );
  });

  test("filters tasks by done status", async ({ page }) => {
    await page.goto("/todo");
    await page.getByTestId("filter-done").click();
    await expect(page.getByTestId("task-item")).toHaveCount(1);
    await expect(page.getByTestId("task-list")).toContainText("Write tests");

    await page.getByTestId("filter-todo").click();
    await expect(page.getByTestId("task-item")).toHaveCount(2);

    await page.getByTestId("filter-all").click();
    await expect(page.getByTestId("task-item")).toHaveCount(3);
  });

  test("creates a new task via form", async ({ page }) => {
    await page.goto("/todo");
    await page.getByTestId("task-input").fill("New task from test");
    await page.getByTestId("add-task").click();
    await expect(page.getByTestId("task-item")).toHaveCount(4);
    await expect(page.getByTestId("task-list")).toContainText(
      "New task from test"
    );
  });
});
