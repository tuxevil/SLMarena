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

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/settings/, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ json: { settings: { ollamaUrl: "http://127.0.0.1:11434", evaluatorBaseUrl: "", evaluatorModel: "", evaluatorApiKeyConfigured: false } } });
      return;
    }
    await route.fulfill({ json: { settings: { ollamaUrl: "http://127.0.0.1:11434", evaluatorBaseUrl: "", evaluatorModel: "", evaluatorApiKeyConfigured: false } } });
  });
  await page.route(/\/api\/prompts(?:\?|$)/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { prompt: { id: "prompt-1", title: "Saved prompt", systemPrompt: "Be concise.", tags: ["demo"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } });
      return;
    }
    await route.fulfill({ json: { prompts: [] } });
  });
  await page.route(/\/api\/suites(?:\?|$)/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { suite: { id: "suite-1", name: "Smoke suite", description: "", promptTemplateId: "prompt-1", userMessages: ["Compare REST and GraphQL."], tags: ["demo"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } });
      return;
    }
    await route.fulfill({ json: { suites: [] } });
  });
  await page.route(/\/api\/runs\?/, async (route) => {
    await route.fulfill({ json: { runs: [], total: 0, page: 1, pageSize: 50 } });
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
});

test("runs a benchmark and renders progressive evaluation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Compare the answer, not the promise." })).toBeVisible();
  await page.getByRole("button", { name: /Discover models/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start benchmark" }).click();

  await expect(page.getByText("REST is simpler for this internal service.")).toBeVisible();
  await expect(page.getByLabel("5 out of 5 stars")).toBeVisible();
  await expect(page.getByText("Grammar: Clean.")).toBeVisible();
  await expect(page.getByText("Compliance")).toBeVisible();
});

test("saves global settings and exposes prompt/suite controls", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OpenAI-compatible endpoint").fill("https://judge.example/v1");
  await page.getByLabel("Judge model").fill("judge");
  await page.getByRole("button", { name: "Save global settings" }).click();
  await expect(page.getByText("Global settings saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save template" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save suite" })).toBeVisible();
});

function createRun(status: string, resultPatch: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status,
    paused: false,
    controlVersion: 0,
    systemPrompt: "Be concise.",
    userMessages: ["Compare REST and GraphQL."],
    models: ["llama3.2"],
    parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    evaluatorModel: status === "COMPLETED" ? "judge" : null,
    results: [{
      id: "result-1",
      modelName: "llama3.2",
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
