/**
 * CRITICAL END-TO-END ACCEPTANCE TEST (browser).
 *
 * UPLOAD -> PARSE -> VALIDATE -> DISPLAY -> SELECT ROW 1 -> SIMULATE THIS SAMPLE
 * -> backend pipeline (preprocessing, random forest, grip engine) -> 3D hand state
 * machine -> HOLD -> LIFT -> RELEASE -> SAVE HISTORY
 *
 * Requires the backend and frontend to be running (see README "Testing").
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EMAIL = process.env.E2E_EMAIL ?? "demo@neurogrip.dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "demo-password-2026";

const CSV = [
  "row_id,pressure,temperature,vibration,conductivity,contact_duration",
  "1,229.8,27.42,2741.3,1.62e-12,0.151",
  "2,248.1,23.05,2655.0,2.4e6,0.118",
  "3,33.9,32.31,21.7,3.3e-11,1.18",
].join("\n");

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.waitForURL("**/dashboard");
}

/** Poll the visible hand state and record every distinct state until a terminal one. */
async function recordStates(page: Page, timeoutMs = 60_000): Promise<string[]> {
  const seen: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = (await page.getByTestId("hand-state").textContent())?.trim() ?? "";
    if (s && seen.at(-1) !== s) seen.push(s);
    if (s === "COMPLETED" || s === "ERROR") break;
    await page.waitForTimeout(60);
  }
  return seen;
}

test("protected routes require authentication", async ({ page }) => {
  await page.goto("/lab");
  await expect(page).toHaveURL(/\/login/);
});

test("uploaded row 1 drives the real pipeline, the 3D hand and history", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "ng-e2e-"));
  const file = join(dir, "examiner_e2e.csv");
  writeFileSync(file, CSV);

  await login(page);
  await page.goto("/data-studio");

  // UPLOAD -> PARSE -> VALIDATE -> DISPLAY
  await page.getByTestId("file-input").setInputFiles(file);
  const table = page.getByTestId("row-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);

  // SELECT ROW 1 and verify the exact sensor values are shown
  await page.locator('[data-row-index="0"]').click();
  const values = page.getByTestId("selected-row-values");
  await expect(values.locator('[data-feature="pressure"]')).toContainText("229.8");
  await expect(values.locator('[data-feature="temperature"]')).toContainText("27.42");
  await expect(values.locator('[data-feature="conductivity"]')).toContainText("1.62e-12");
  await expect(values.locator('[data-feature="contact_duration"]')).toContainText("0.151");

  // SIMULATE THIS SAMPLE -> capture the real API response
  const responsePromise = page.waitForResponse((r) => /\/api\/datasets\/\d+\/rows\/0\/simulate$/.test(r.url()) && r.request().method() === "POST");
  await page.getByTestId("simulate-sample").click();
  const states = recordStates(page);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json();

  // The exact uploaded row entered the pipeline.
  expect(body.sample).toEqual({ pressure: 229.8, temperature: 27.42, vibration: 2741.3, conductivity: 1.62e-12, contact_duration: 0.151 });
  expect(body.data_source).toBe("UPLOADED");
  expect(body.dataset_ref.row_index).toBe(0);
  expect(body.trace.map((t: { stage: string }) => t.stage)).toEqual(["validation", "preprocessing", "inference", "recognition", "grip", "command"]);
  const probs = Object.values(body.prediction.probabilities) as number[];
  expect(Math.max(...probs)).toBeCloseTo(body.prediction.confidence, 3);

  // The 3D hand state machine ran the full cycle, in order, after the prediction.
  const visited = await states;
  expect(visited.at(-1)).toBe("COMPLETED");
  const order = ["ANALYZING", "PREDICTED", "GRIP_DECISION", "GRIPPING", "HOLDING", "LIFTING", "RELEASING", "COMPLETED"];
  const idx = order.map((s) => visited.indexOf(s));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);

  // The UI shows the model's actual output and the grip engine's decision.
  await expect(page.getByTestId("predicted-material")).toContainText(body.prediction.display_label);
  await expect(page.getByTestId("prediction-confidence")).toContainText(`${(body.prediction.confidence * 100).toFixed(1)}%`);
  await expect(page.getByTestId("grip-percent")).toContainText(body.grip.grip_percent.toFixed(1));

  // SAVE HISTORY
  expect(body.persisted).toBe(true);
  await page.goto("/history");
  const first = page.getByTestId("history-table").locator("tbody tr").first();
  await expect(first).toContainText("UPLOADED");
  await expect(first).toContainText(body.prediction.display_label);
  await expect(first).toContainText(`${body.grip.grip_percent.toFixed(1)}%`);
});

test("simulated Glass demo runs every hand state in order", async ({ page }) => {
  await login(page);
  await page.goto("/lab");
  await page.getByTestId("run-grasp").waitFor();
  const predict = page.waitForResponse((r) => r.url().endsWith("/api/predict") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Demo 1: Glass" }).click();
  const states = await recordStates(page);
  const body = await (await predict).json();
  expect(body.data_source).toBe("SIMULATED");
  expect(body.ground_truth).toBe("Glass");
  for (const s of ["OPEN", "APPROACHING", "SENSING", "CONTACT", "ANALYZING", "PREDICTED", "GRIP_DECISION", "GRIPPING", "HOLDING", "LIFTING", "RELEASING", "COMPLETED"]) {
    expect(states).toContain(s);
  }
  expect(states.indexOf("ANALYZING")).toBeLessThan(states.indexOf("PREDICTED"));
  await expect(page.getByTestId("grip-percent")).toContainText(body.grip.grip_percent.toFixed(1));
});

test("batch processing evaluates a labelled dataset", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "ng-e2e-"));
  const file = join(dir, "labelled_e2e.csv");
  writeFileSync(file, CSV.split("\n").map((l, i) => (i === 0 ? `${l},material` : `${l},${["Glass", "Steel", "Fabric"][i - 1]}`)).join("\n"));
  await login(page);
  await page.goto("/data-studio");
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page.getByTestId("row-table").locator("tbody tr")).toHaveCount(3);
  const batch = page.waitForResponse((r) => r.url().endsWith("/api/process-batch"));
  await page.getByTestId("process-batch").click();
  const body = await (await batch).json();
  expect(body.processed).toBe(3);
  expect(body.evaluation.labeled_rows).toBe(3);
  await expect(page.getByTestId("batch-table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByText("Accuracy", { exact: true })).toBeVisible();
});

test("simulated live stream feeds the same pipeline and a live grasp is stored", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/simulator");
  // Idempotent: a previous aborted run may have left the server-side stream running.
  const stop = page.getByRole("button", { name: "Stop stream" });
  const start = page.getByTestId("stream-start");
  await expect(start.or(stop)).toBeVisible();
  if (await stop.isVisible()) {
    await stop.click();
    await expect(start).toBeVisible();
  }
  await start.click();
  await expect(page.getByText("LIVE · CONNECTED")).toBeVisible();
  await expect(page.getByText("SIMULATED LIVE STREAM").first()).toBeVisible();
  await expect(page.getByTestId("live-feed").locator("tbody tr").first()).toBeVisible();

  await page.goto("/lab");
  await page.getByRole("radio", { name: /LIVE SENSOR/ }).click();
  const live = page.waitForResponse((r) => /\/api\/sensors\/live\/\d+\/predict$/.test(r.url()));
  await page.getByTestId("run-grasp").click();
  const states = await recordStates(page);
  const body = await (await live).json();
  expect(states.at(-1)).toBe("COMPLETED");
  expect(body.data_source).toBe("LIVE");
  expect(body.source_detail).toBe("SIMULATED_LIVE_STREAM");
  expect(body.live_sample.features.pressure).toBe(body.sample.pressure);
  expect(body.persisted).toBe(true);

  await page.goto("/simulator");
  await page.getByRole("button", { name: "Stop stream" }).click();
});
