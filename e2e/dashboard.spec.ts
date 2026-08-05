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
    await route.fulfill({ json: { runs: [completedRun], total: 1, page: 1, pageSize: 50 } });
  });
  await page.route(/\/api\/leaderboard\?/, async (route) => {
    await route.fulfill({
      json: {
        models: [
          {
            modelName: "llama3.2",
            paramSizeLabel: "4B",
            paramSizeValue: 4,
            samplesCount: 2,
            evaluatedSamplesCount: 2,
            avgQualityStars: 4.0,
            avgTtftMs: 85,
            avgTokPerSec: 18.5,
            attackSuccessRatePct: 0,
            arenaIndex: 88,
            radar: {
              instructionOverrideResistance: 100,
              systemPromptLeakageResistance: 100,
              indirectInjectionDefense: 100,
              systemPromptAdherence: 100,
            },
          },
        ],
        kpis: {
          totalBenchmarkRuns: 1,
          avgTokPerSec: 18.5,
          avgTtftMs: 85,
          totalAttackScenarios: 0,
          avgAttackSuccessRatePct: 0,
        },
      },
    });
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

test("renders the arena dashboard and displays top model winner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SLMArena")).toBeVisible();
  await expect(page.getByText("Top Winning SLM Model")).toBeVisible();
  await expect(page.locator(".winner-name", { hasText: "llama3.2" })).toBeVisible();
});

test("supports scenario saving and adding conversation turns in execution builder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Run" }).click();

  // Save scenario
  await page.getByRole("button", { name: "💾 Save to Library" }).click();
  await expect(page.locator(".global-notice-banner", { hasText: "saved to library" })).toBeVisible();

  // Add turn
  await page.getByRole("button", { name: "+ Add Conversation Turn" }).click();
  await expect(page.getByText("Turn 2")).toBeVisible();
});

test("launches a benchmark via the 3-step wizard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Run" }).click();

  // Step 1
  await page.getByRole("button", { name: /Next: Select Models/ }).click();

  // Step 2
  await page.getByRole("button", { name: /Scan Local Ollama/ }).click();
  await page.locator(".model-checkbox-card", { hasText: "llama3.2" }).click();
  await page.getByRole("button", { name: /Next: Configure & Launch/ }).click();

  // Step 3
  await page.getByRole("button", { name: /Launch Benchmark & Evaluate/ }).click();

  // Should transition to history matrix tab
  await expect(page.locator(".history-matrix-panel")).toBeVisible();
});

test("displays detailed model-grouped view in history tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "History & Failures" }).click();

  await expect(page.getByText("Model-Grouped Results")).toBeVisible();
  await expect(page.locator(".group-card-header", { hasText: "llama3.2" })).toBeVisible();
  await page.locator(".sample-item-summary").first().click();
  await expect(page.getByText("REST is simpler for this internal service.")).toBeVisible();
});

test("saves global settings in settings tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByPlaceholder("https://api.openai.com/v1").fill("https://judge.example/v1");
  await page.getByPlaceholder("gpt-4o-mini, openrouter/auto...").fill("judge");
  await page.getByRole("button", { name: "💾 Save Settings" }).click();

  await expect(page.locator(".global-notice-banner", { hasText: "Settings saved successfully." })).toBeVisible();
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
