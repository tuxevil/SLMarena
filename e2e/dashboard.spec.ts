import { expect, test } from "@playwright/test";

const pendingRun = createRun("PENDING");
const completedRun = createRun("COMPLETED", {
  status: "COMPLETED",
  evalStatus: "COMPLETED",
  responseText: "REST is simpler for this internal service.",
  inputTokens: 12,
  outputTokens: 24,
  ttftMs: 85,
  tokPerSec: 18.5,
  totalDurationMs: 1_300,
  evaluation: {
    evaluatorModel: "judge",
    grammarRating: 5,
    complianceRating: 4,
    accuracyRating: 5,
    scoreStars: 5,
    grammarAnalysis: "Clean.",
    complianceAnalysis: "Followed the prompt.",
    accuracyAnalysis: "Accurate.",
    feedbackText: "Strong answer.",
    rawJson: {},
  },
});
completedRun.samplesPerModel = 2;
completedRun.results.push({
  ...completedRun.results[0],
  id: "result-2",
  sampleIndex: 1,
  responseText: "GraphQL adds flexibility for clients.",
  evaluation: {
    evaluatorModel: "judge",
    grammarRating: 3,
    complianceRating: 3,
    accuracyRating: 3,
    scoreStars: 3,
    grammarAnalysis: "Readable.",
    complianceAnalysis: "Mostly followed the prompt.",
    accuracyAnalysis: "Accurate enough.",
    feedbackText: "Solid answer.",
    rawJson: {},
  },
});
completedRun.models = ["llama3.2", "qwen2.5"];
completedRun.results.push({
  ...completedRun.results[0],
  id: "result-3",
  modelName: "qwen2.5",
  sampleIndex: 0,
  responseText: "Qwen gives a shorter comparison.",
  evaluation: {
    evaluatorModel: "judge",
    grammarRating: 2,
    complianceRating: 2,
    accuracyRating: 2,
    scoreStars: 2,
    grammarAnalysis: "Needs polish.",
    complianceAnalysis: "Missed some detail.",
    accuracyAnalysis: "Partially accurate.",
    feedbackText: "Needs another pass.",
    rawJson: {},
  },
});

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/settings/, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ json: { settings: { ollamaUrl: "http://127.0.0.1:11434", evaluatorBaseUrl: "", evaluatorModel: "", evaluatorApiKeyConfigured: false } } });
      return;
    }
    await route.fulfill({ json: { settings: { ollamaUrl: "http://127.0.0.1:11434", evaluatorBaseUrl: "", evaluatorModel: "", evaluatorApiKeyConfigured: false } } });
  });
  await page.route(/\/api\/scenarios(?:\?|$)/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { scenario: { id: "scenario-1", name: "Smoke scenario", systemPrompt: "Be concise.", userMessages: ["Compare REST and GraphQL."], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } });
      return;
    }
    await route.fulfill({ json: { scenarios: [] } });
  });
  await page.route(/\/api\/runs\?/, async (route) => {
    await route.fulfill({ json: { runs: [], total: 0, page: 1, pageSize: 50 } });
  });
  await page.route(/\/api\/analysis\?/, async (route) => {
    await route.fulfill({ json: {
      scenarioKey: "scenario:scenario-1",
      runs: 2,
      results: [],
      bestModel: { modelName: "llama3.2", averageStars: 4.5 },
      models: [{
        modelName: "llama3.2",
        samples: 4,
        evaluatedSamples: 4,
        failures: 0,
        distribution: { 4: 2, 5: 2 },
        averageStars: 4.5,
        averageTtftMs: 92,
        averageOutputTokens: 24,
        averageTokPerSec: 18.5,
        averageTotalDurationMs: 1_300,
      }],
    } });
  });
  await page.route(/\/api\/ollama\/models/, async (route) => {
    await route.fulfill({ json: { models: [{ name: "llama3.2", size: "4 GB" }] } });
  });
  await page.route(/\/api\/runs$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 202, json: { run: pendingRun } });
  });
  await page.route(/\/api\/runs\/run-1\/events/, async (route) => {
    const snapshot = JSON.stringify({ type: "run.snapshot", run: pendingRun });
    const completed = JSON.stringify({ type: "model.completed", run: completedRun });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: `data: ${snapshot}\n\ndata: ${completed}\n\n`,
    });
  });
  await page.route(/\/api\/runs\/run-1\/results\/.+/, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    await route.fulfill({ status: 204 });
  });
});

test("runs a benchmark and renders progressive evaluation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Benchmark workspace" })).toBeVisible();
  await page.getByRole("button", { name: /Discover models/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start benchmark" }).click();

  const resultList = page.getByRole("region", { name: "Benchmark test list" });
  await expect(resultList.getByRole("button", { name: "Expand all" })).toBeVisible();
  await expect(resultList.locator(".response-full").first()).toBeHidden();
  await resultList.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByText("REST is simpler for this internal service.")).toBeVisible();
  await expect(page.getByLabel("5 out of 5 stars")).toBeVisible();
  await expect(page.getByText("Grammar: Clean.")).toBeVisible();
  await expect(page.locator(".test-item").first().locator(".test-score-name", { hasText: "Compliance" })).toBeVisible();
});

test("keeps each benchmark result in a collapsible test row", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Discover models/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start benchmark" }).click();

  const resultList = page.getByRole("region", { name: "Benchmark test list" });
  await expect(resultList.locator(".model-result-group")).toHaveCount(2);
  await expect(resultList.locator(".model-result-group").nth(0).locator(".model-group-header h3")).toHaveText("llama3.2");
  await expect(resultList.locator(".model-result-group").nth(1).locator(".model-group-header h3")).toHaveText("qwen2.5");
  await expect(resultList.locator(".model-score")).toHaveCount(2);
  await expect(resultList.locator(".model-score").first()).toBeVisible();
  await expect(resultList.locator(".model-score").first()).toContainText("4.0");
  await expect(resultList.locator(".model-score").first()).toContainText("Min");
  await expect(resultList.locator(".model-score").first()).toContainText("Max");
  await expect(resultList.locator(".model-score").first()).toContainText("Average ratings");
  const ratingAverages = resultList.locator(".model-score-ratings").first().locator(".model-score-rating");
  await expect(ratingAverages).toHaveCount(3);
  await expect(ratingAverages.nth(0)).toContainText("Grammar");
  await expect(ratingAverages.nth(0)).toContainText("4.00/5");
  await expect(ratingAverages.nth(1)).toContainText("Compliance");
  await expect(ratingAverages.nth(1)).toContainText("3.50/5");
  await expect(ratingAverages.nth(2)).toContainText("Accuracy");
  await expect(ratingAverages.nth(2)).toContainText("4.00/5");
  await expect(resultList.locator(".model-score").first()).toContainText("Avg telemetry");
  const telemetryAverages = resultList.locator(".model-score-telemetry").first().locator(".model-score-rating");
  await expect(telemetryAverages).toHaveCount(4);
  await expect(telemetryAverages.nth(0)).toContainText("Output");
  await expect(telemetryAverages.nth(1)).toContainText("TTFT");
  await expect(telemetryAverages.nth(2)).toContainText("Tok/s");
  await expect(telemetryAverages.nth(3)).toContainText("Total");
  await expect(resultList.locator("details.test-item")).toHaveCount(3);
  const firstGroup = resultList.locator(".model-result-group").first();
  await firstGroup.getByRole("button", { name: "Collapse llama3.2 results" }).click();
  await expect(firstGroup.locator(".model-group-results")).toBeHidden();
  await firstGroup.getByRole("button", { name: "Expand llama3.2 results" }).click();
  await expect(firstGroup.locator(".model-group-results")).toBeVisible();
  await resultList.getByRole("button", { name: "Collapse groups" }).click();
  await expect(firstGroup.locator(".model-group-results")).toBeHidden();
  await expect(resultList.locator(".model-result-group").nth(1).locator(".model-group-results")).toBeHidden();
  await resultList.getByRole("button", { name: "Expand groups" }).click();
  await expect(firstGroup.locator(".model-group-results")).toBeVisible();
  await expect(resultList.getByRole("button", { name: "Expand all" })).toBeVisible();
  await expect(resultList.locator(".response-full").first()).toBeHidden();
  await resultList.getByRole("button", { name: "Expand all" }).click();
  await resultList.getByRole("button", { name: "Collapse all" }).click();
  await expect(resultList.getByRole("button", { name: "Expand all" })).toBeVisible();
  await expect(resultList.locator(".response-full").first()).toBeHidden();
  await expect(resultList.locator(".response-full").nth(1)).toBeHidden();
  await expect(resultList.locator(".response-full").nth(2)).toBeHidden();
  await resultList.getByRole("button", { name: "Expand all" }).click();
  await expect(resultList.locator(".response-full").first()).toBeVisible();
  await expect(resultList.locator(".response-full").nth(1)).toBeVisible();
  await expect(resultList.locator(".response-full").nth(2)).toBeVisible();
});

test("deletes a sample from the consolidated results", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Discover models/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start benchmark" }).click();

  const resultList = page.getByRole("region", { name: "Benchmark test list" });
  await expect(resultList.locator("details.test-item")).toHaveCount(3);
  await resultList.getByRole("button", { name: "Expand all" }).click();
  await expect(resultList.getByRole("button", { name: "Delete sample" })).toHaveCount(3);

  page.once("dialog", (dialog) => void dialog.accept());
  await resultList.getByRole("button", { name: "Delete sample" }).first().click();

  await expect(resultList.locator("details.test-item")).toHaveCount(2);
  await expect(resultList.getByRole("button", { name: "Delete sample" })).toHaveCount(2);
});

test("saves global settings and exposes scenario controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("OpenAI-compatible endpoint").fill("https://judge.example/v1");
  await page.getByLabel("Judge model").fill("judge");
  await page.getByRole("button", { name: "Save global settings" }).click();
  await expect(page.getByText("Global settings saved.")).toBeVisible();
  await page.getByRole("button", { name: "Benchmark", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save scenario" })).toBeVisible();
});

function createRun(status: string, resultPatch: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status,
    paused: false,
    controlVersion: 0,
    scenarioId: null,
    samplesPerModel: 1,
    systemPrompt: "Be concise.",
    userMessages: ["Compare REST and GraphQL."],
    models: ["llama3.2"],
    parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    evaluatorModel: status === "COMPLETED" ? "judge" : null,
    results: [{
      id: "result-1",
      modelName: "llama3.2",
      sampleIndex: 0,
      status,
      evalStatus: status === "COMPLETED" ? "COMPLETED" : "PENDING",
      responseText: null,
      turns: [],
      evaluation: null,
      humanStatus: "UNREVIEWED",
      humanNotes: "",
      errorMessage: null,
      ttftMs: null,
      inputTokens: null,
      outputTokens: null,
      tokPerSec: null,
      totalDurationMs: null,
      ...resultPatch,
    }],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: status === "COMPLETED" ? new Date().toISOString() : null,
    errorMessage: null,
  };
}
