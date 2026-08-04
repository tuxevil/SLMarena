"use client";

import { useEffect, useRef, useState } from "react";
import type { HumanStatus, ModelResult, Scenario, TestRun } from "@/lib/contracts";

type ModelOption = {
  name: string;
  size: string;
};

type ParameterState = {
  temperature: string;
  numCtx: string;
  topP: string;
  repeatPenalty: string;
  numPredict: string;
};

type ModelAggregate = {
  modelName: string;
  samples: number;
  evaluatedSamples: number;
  failures: number;
  distribution: Record<number, number>;
  averageStars: number | null;
  averageTtftMs: number | null;
  averageOutputTokens: number | null;
  averageTokPerSec: number | null;
  averageTotalDurationMs: number | null;
};

type ConsolidatedResult = {
  runId: string;
  runCreatedAt: string;
  result: ModelResult;
};

type ScenarioAnalysis = {
  scenarioKey: string;
  runs: number;
  models: ModelAggregate[];
  results: ConsolidatedResult[];
  bestModel: { modelName: string; averageStars: number } | null;
};

type SettingsPayload = {
  settings?: {
    ollamaUrl: string;
    evaluatorBaseUrl: string;
    evaluatorModel: string;
    evaluatorApiKeyConfigured: boolean;
    parameters?: { temperature: number; numCtx: number; topP: number; repeatPenalty: number; numPredict: number };
  };
};

const DEFAULT_SYSTEM_PROMPT = "You are a precise technical assistant. Explain trade-offs clearly and do not invent facts.";
const DEFAULT_MESSAGES = ["Compare REST and GraphQL for a small internal service."];

function getInitialLocalSettings(): {
  ollamaUrl?: string;
  evaluatorBaseUrl?: string;
  evaluatorModel?: string;
  parameters?: ParameterState;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("slmarena_settings");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function BenchmarkDashboard() {
  const [tab, setTab] = useState<"benchmark" | "settings">("benchmark");

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [scenarioName, setScenarioName] = useState("New scenario");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [messages, setMessages] = useState<string[]>(DEFAULT_MESSAGES);
  const [editingLocked, setEditingLocked] = useState(false);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [samplesPerModel, setSamplesPerModel] = useState("1");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [analysis, setAnalysis] = useState<ScenarioAnalysis | null>(null);

  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [evaluatorBaseUrl, setEvaluatorBaseUrl] = useState("");
  const [evaluatorApiKey, setEvaluatorApiKey] = useState("");
  const [evaluatorModel, setEvaluatorModel] = useState("");
  const [evaluatorKeyConfigured, setEvaluatorKeyConfigured] = useState(false);
  const [parameters, setParameters] = useState<ParameterState>({
    temperature: "0.2",
    numCtx: "8192",
    topP: "0.9",
    repeatPenalty: "1.1",
    numPredict: "4096",
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [activeRun, setActiveRun] = useState<TestRun | null>(null);
  const [history, setHistory] = useState<TestRun[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilter, setHistoryFilter] = useState("");
  const [historyDate, setHistoryDate] = useState("");
  const [historyModel, setHistoryModel] = useState("");
  const [historyScore, setHistoryScore] = useState("");
  const [notice, setNotice] = useState("");
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const consolidatedItems = buildConsolidatedItems(analysis?.results ?? [], activeRun);

  useEffect(() => {
    void fetch("/api/settings")
      .then((response) => response.json() as Promise<SettingsPayload>)
      .then((payload) => {
        if (payload.settings?.ollamaUrl || payload.settings?.evaluatorBaseUrl || payload.settings?.evaluatorModel) {
          setOllamaUrl(payload.settings.ollamaUrl);
          setEvaluatorBaseUrl(payload.settings.evaluatorBaseUrl);
          setEvaluatorModel(payload.settings.evaluatorModel);
          setEvaluatorKeyConfigured(payload.settings.evaluatorApiKeyConfigured);
          if (payload.settings.parameters) {
            setParameters({
              temperature: String(payload.settings.parameters.temperature),
              numCtx: String(payload.settings.parameters.numCtx),
              topP: String(payload.settings.parameters.topP),
              repeatPenalty: String(payload.settings.parameters.repeatPenalty),
              numPredict: String(payload.settings.parameters.numPredict),
            });
          }
          return;
        }
        const local = getInitialLocalSettings();
        if (local) {
          if (local.ollamaUrl) setOllamaUrl(local.ollamaUrl);
          if (local.evaluatorBaseUrl !== undefined) setEvaluatorBaseUrl(local.evaluatorBaseUrl);
          if (local.evaluatorModel !== undefined) setEvaluatorModel(local.evaluatorModel);
          if (local.parameters) setParameters(local.parameters);
        }
      })
      .catch(() => {
        const local = getInitialLocalSettings();
        if (local) {
          if (local.ollamaUrl) setOllamaUrl(local.ollamaUrl);
          if (local.evaluatorBaseUrl !== undefined) setEvaluatorBaseUrl(local.evaluatorBaseUrl);
          if (local.evaluatorModel !== undefined) setEvaluatorModel(local.evaluatorModel);
          if (local.parameters) setParameters(local.parameters);
        }
      });

    void fetch("/api/scenarios")
      .then((response) => response.json() as Promise<{ scenarios?: Scenario[] }>)
      .then((payload) => setScenarios(payload.scenarios ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      keyword: historyFilter,
      date: historyDate,
      model: historyModel,
      score: historyScore,
      timezoneOffset: String(new Date().getTimezoneOffset()),
      page: "1",
      pageSize: "50",
    });
    void fetch(`/api/runs?${params}`)
      .then((response) => response.json() as Promise<{ runs?: TestRun[]; total?: number }>)
      .then((payload) => {
        setHistory(payload.runs ?? []);
        setHistoryTotal(payload.total ?? 0);
      })
      .catch(() => undefined);
  }, [historyDate, historyFilter, historyModel, historyScore, historyRefreshKey]);

  const scenarioRef = useRef({ selectedScenarioId, systemPrompt, messages });
  useEffect(() => {
    scenarioRef.current = { selectedScenarioId, systemPrompt, messages };
  });

  useEffect(() => {
    if (!activeRun?.id) return;

    const source = new EventSource(`/api/runs/${activeRun.id}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { run: TestRun };
      setActiveRun(payload.run);
      setHistory((current) => [payload.run, ...current.filter((item) => item.id !== payload.run.id)]);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(payload.run.status)) {
        source.close();
        const scenario = scenarioRef.current;
        void fetchScenarioAnalysis(scenario.selectedScenarioId, scenario.systemPrompt, scenario.messages).then((payload) => {
          if (payload) setAnalysis(payload);
        });
      }
    };
    source.onerror = () => setNotice("Live connection interrupted. The browser will retry automatically.");

    return () => source.close();
  }, [activeRun?.id]);

  useEffect(() => {
    if (!systemPrompt.trim() || messages.some((message) => !message.trim())) return;
    const timer = setTimeout(() => {
      void fetchScenarioAnalysis(selectedScenarioId, systemPrompt, messages).then((payload) => {
        if (payload) setAnalysis(payload);
      });
    }, selectedScenarioId ? 0 : 500);
    return () => clearTimeout(timer);
  }, [selectedScenarioId, systemPrompt, messages, analysisRefreshKey]);

  function addMessage() {
    setMessages((current) => [...current, ""]);
  }

  function updateMessage(index: number, content: string) {
    setMessages((current) => current.map((message, messageIndex) => (messageIndex === index ? content : message)));
  }

  function removeMessage(index: number) {
    setMessages((current) => current.filter((_, messageIndex) => messageIndex !== index));
  }

  function toggleModel(modelName: string) {
    setSelectedModels((current) =>
      current.includes(modelName) ? current.filter((name) => name !== modelName) : [...current, modelName],
    );
  }

  function loadScenario(id: string) {
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) return;
    setSelectedScenarioId(id);
    setScenarioName(scenario.name);
    setSystemPrompt(scenario.systemPrompt);
    setMessages(scenario.userMessages);
    setEditingLocked(true);
  }

  function onScenarioChange(value: string) {
    if (!value) {
      setSelectedScenarioId("");
      setScenarioName("New scenario");
      setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
      setMessages(DEFAULT_MESSAGES);
      setEditingLocked(false);
      return;
    }
    loadScenario(value);
  }

  function duplicateToDraft() {
    setSelectedScenarioId("");
    setEditingLocked(false);
    setScenarioName((current) => (current === "New scenario" ? "Copy of draft" : `${current} (copy)`));
    setNotice("Editing a copy. Save it under a new name when ready.");
  }

  async function saveScenario() {
    if (!scenarioName.trim()) {
      setNotice("Give the scenario a name before saving.");
      return;
    }
    if (!systemPrompt.trim()) {
      setNotice("The scenario needs a system prompt.");
      return;
    }
    if (messages.some((message) => !message.trim())) {
      setNotice("Every user turn needs content before saving.");
      return;
    }
    const response = await fetch("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: scenarioName.trim(), systemPrompt, userMessages: messages }),
    });
    const payload = (await response.json()) as { scenario?: Scenario; error?: string };
    if (!response.ok || !payload.scenario) {
      setNotice(payload.error ?? "Could not save scenario.");
      return;
    }
    setScenarios((current) => [payload.scenario!, ...current.filter((item) => item.id !== payload.scenario!.id)]);
    setSelectedScenarioId(payload.scenario.id);
    setEditingLocked(true);
    setNotice("Scenario saved to the library.");
  }

  async function deleteScenario() {
    if (!selectedScenarioId || !window.confirm("Delete this scenario?")) return;
    const response = await fetch(`/api/scenarios/${selectedScenarioId}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice("Could not delete scenario.");
      return;
    }
    setScenarios((current) => current.filter((item) => item.id !== selectedScenarioId));
    setSelectedScenarioId("");
    setScenarioName("New scenario");
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setMessages(DEFAULT_MESSAGES);
    setEditingLocked(false);
    setNotice("Scenario deleted.");
  }

  async function discoverModels() {
    setIsDiscovering(true);
    setNotice("");

    try {
      const response = await fetch(`/api/ollama/models?url=${encodeURIComponent(ollamaUrl)}`);
      const payload = (await response.json()) as { models?: ModelOption[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not connect to Ollama.");
      }

      setModels(payload.models ?? []);
      setSelectedModels([]);
      setNotice(`${payload.models?.length ?? 0} models discovered.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect to Ollama.");
    } finally {
      setIsDiscovering(false);
    }
  }

  async function startBenchmark() {
    if (selectedModels.length === 0) {
      setNotice("Select at least one local model before starting.");
      return;
    }

    if (messages.some((message) => message.trim().length === 0)) {
      setNotice("Every user turn needs content before starting.");
      return;
    }

    setIsStarting(true);
    setNotice("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ollamaUrl,
          scenarioId: selectedScenarioId || null,
          samplesPerModel: clampSamples(samplesPerModel),
          systemPrompt,
          userMessages: messages,
          models: selectedModels,
          parameters: {
            temperature: Number(parameters.temperature),
            numCtx: Number(parameters.numCtx),
            topP: Number(parameters.topP),
            repeatPenalty: Number(parameters.repeatPenalty),
            numPredict: Number(parameters.numPredict),
          },
        }),
      });
      const payload = (await response.json()) as { run?: TestRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "Could not start benchmark.");
      setActiveRun(payload.run);
      setNotice("Benchmark queued. Results will arrive as each model finishes.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start benchmark.");
    } finally {
      setIsStarting(false);
    }
  }

  async function saveSettings(clearEvaluatorApiKey = false) {
    setIsSavingSettings(true);
    try {
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(
            "slmarena_settings",
            JSON.stringify({
              ollamaUrl,
              evaluatorBaseUrl,
              evaluatorModel,
              parameters,
            }),
          );
        } catch {}
      }

      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ollamaUrl,
          evaluatorBaseUrl,
          evaluatorModel,
          ...(evaluatorApiKey ? { evaluatorApiKey } : {}),
          clearEvaluatorApiKey,
          parameters: {
            temperature: Number(parameters.temperature),
            numCtx: Number(parameters.numCtx),
            topP: Number(parameters.topP),
            repeatPenalty: Number(parameters.repeatPenalty),
            numPredict: Number(parameters.numPredict),
          },
        }),
      });
      const payload = (await response.json()) as { settings?: { evaluatorApiKeyConfigured: boolean }; error?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? "Could not save settings.");
      setEvaluatorApiKey("");
      setEvaluatorKeyConfigured(payload.settings.evaluatorApiKeyConfigured);
      setNotice("Global settings saved.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save settings.");
      return false;
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function cancelBenchmark() {
    if (!activeRun) return;
    const response = await fetch(`/api/runs/${activeRun.id}/cancel`, { method: "POST" });
    const payload = (await response.json()) as { run?: TestRun; error?: string };
    if (!response.ok || !payload.run) {
      setNotice(payload.error ?? "Could not cancel benchmark.");
      return;
    }
    setActiveRun(payload.run);
    setHistory((current) => [payload.run!, ...current.filter((item) => item.id !== payload.run!.id)]);
  }

  async function togglePause() {
    if (!activeRun) return;
    const action = activeRun.paused ? "resume" : "pause";
    const response = await fetch(`/api/runs/${activeRun.id}/${action}`, { method: "POST" });
    const payload = (await response.json()) as { run?: TestRun; error?: string };
    if (!response.ok || !payload.run) {
      setNotice(payload.error ?? `Could not ${action} benchmark.`);
      return;
    }
    setActiveRun(payload.run);
  }

  async function updateReview(result: ModelResult, status: HumanStatus) {
    if (!activeRun) return;
    const response = await fetch(`/api/results/${result.id}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, notes: result.humanNotes }),
    });
    const payload = (await response.json()) as { run?: TestRun; error?: string };
    if (!response.ok || !payload.run) {
      setNotice(payload.error ?? "Could not update review.");
      return;
    }
    setActiveRun(payload.run);
    setHistory((current) => [payload.run!, ...current.filter((item) => item.id !== payload.run!.id)]);
  }

  async function handleDeleteResult(runId: string, resultId: string) {
    const response = await fetch(`/api/runs/${runId}/results/${resultId}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice("Could not delete the sample. It may already be gone.");
      return;
    }
    setActiveRun((current) =>
      current ? { ...current, results: current.results.filter((result) => result.id !== resultId) } : current,
    );
    setAnalysisRefreshKey((key) => key + 1);
    setHistoryRefreshKey((key) => key + 1);
  }

  const historyModels = [...new Set(history.flatMap((run) => run.models))].sort();

  return (
    <main className="shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <div>
            <p className="eyebrow">SLMarena / control room</p>
            <h1>Benchmark workspace</h1>
          </div>
        </div>
        <div className="dashboard-header-actions">
          <div className="connection-pill">
            <span className="connection-dot" aria-hidden="true" />
            Ollama: {ollamaUrl}
          </div>
          <nav className="tab-bar" aria-label="Workspace tabs">
            <button
              className={tab === "benchmark" ? "tab-button active" : "tab-button"}
              onClick={() => setTab("benchmark")}
              type="button"
            >
              Benchmark
            </button>
            <button
              className={tab === "settings" ? "tab-button active" : "tab-button"}
              onClick={() => setTab("settings")}
              type="button"
            >
              Settings
            </button>
          </nav>
        </div>
      </header>

      {tab === "benchmark" ? (
        <div className="workspace">
          <aside className="panel controls" aria-label="Benchmark configuration">
            <div className="controls-header">
              <div>
                <p className="section-label">Test setup</p>
                <h2>Shape the challenge</h2>
              </div>
              <span className="card-kicker">{editingLocked ? "Saved" : "Draft"}</span>
            </div>

            <section className="control-section">
              <div className="field">
                <label htmlFor="scenario-library">Scenario</label>
                <select
                  className="input"
                  id="scenario-library"
                  onChange={(event) => onScenarioChange(event.target.value)}
                  value={selectedScenarioId}
                >
                  <option value="">New scenario (draft)</option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="scenario-name">Scenario name</label>
                <input
                  className="input"
                  disabled={editingLocked}
                  id="scenario-name"
                  onChange={(event) => setScenarioName(event.target.value)}
                  type="text"
                  value={scenarioName}
                />
              </div>
              <div className="field">
                <div className="result-card-top">
                  <label htmlFor="system-prompt">System prompt</label>
                  <div className="conversation-actions">
                    <button
                      className="quiet-button"
                      disabled={editingLocked}
                      onClick={() => void saveScenario()}
                      type="button"
                    >
                      Save scenario
                    </button>
                    {editingLocked ? (
                      <>
                        <button className="quiet-button" onClick={duplicateToDraft} type="button">
                          Edit copy
                        </button>
                        <button className="quiet-button" onClick={() => void deleteScenario()} type="button">
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <textarea
                  className="textarea"
                  disabled={editingLocked}
                  id="system-prompt"
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  value={systemPrompt}
                />
              </div>
            </section>

            <section className="control-section">
              <div className="result-card-top">
                <p className="section-label">Conversation</p>
                <div className="conversation-actions">
                  <button className="quiet-button" disabled={editingLocked} onClick={addMessage} type="button">
                    + Add turn
                  </button>
                </div>
              </div>
              {messages.map((message, index) => (
                <div className="field" key={`message-${index}`}>
                  <label htmlFor={`message-${index}`}>User turn {index + 1}</label>
                  <textarea
                    className="textarea"
                    disabled={editingLocked}
                    id={`message-${index}`}
                    onChange={(event) => updateMessage(index, event.target.value)}
                    value={message}
                  />
                  {messages.length > 1 && !editingLocked ? (
                    <button className="quiet-button" onClick={() => removeMessage(index)} type="button">
                      Remove turn
                    </button>
                  ) : null}
                </div>
              ))}
              {editingLocked ? (
                <p className="saved-secret">Saved scenarios are locked. Use “Edit copy” to change them without touching the original.</p>
              ) : null}
            </section>

            <section className="control-section">
              <p className="section-label">Local models</p>
              <div className="field">
                <button className="quiet-button" disabled={isDiscovering} onClick={() => void discoverModels()} type="button">
                  {isDiscovering ? "Checking endpoint..." : "Discover models ↗"}
                </button>
              </div>
              <div className="field">
                <label htmlFor="samples-per-model">Samples per model (responses per run)</label>
                <input
                  className="input"
                  id="samples-per-model"
                  max="10"
                  min="1"
                  onChange={(event) => setSamplesPerModel(event.target.value)}
                  type="number"
                  value={samplesPerModel}
                />
              </div>
              <div className="model-list">
                {models.length > 0 ? (
                  models.map((model) => (
                    <label className="model-option" key={model.name}>
                      <input
                        checked={selectedModels.includes(model.name)}
                        onChange={() => toggleModel(model.name)}
                        type="checkbox"
                      />
                      <span>{model.name}</span>
                      <span style={{ color: "var(--muted)", marginLeft: "auto" }}>{model.size}</span>
                    </label>
                  ))
                ) : (
                  <div className="empty-models">Connect to Ollama to load the models available on the remote host.</div>
                )}
              </div>
            </section>

            {notice ? <div className="notice">{notice}</div> : null}
            <button
              className="primary-button"
              disabled={selectedModels.length === 0 || isStarting}
              onClick={() => void startBenchmark()}
              type="button"
            >
              {isStarting ? "Queueing benchmark..." : "Start benchmark"}
            </button>
          </aside>

          <section className="content" aria-label="Benchmark results">
            <div className="content-topline">
              <div>
                <p className="section-label">Live comparison</p>
                <h2>{activeRun ? "Results are arriving model by model." : "Results will land here, model by model."}</h2>
              </div>
              {activeRun ? (
                <div className="run-actions">
                  <button
                    className="quiet-button"
                    disabled={["COMPLETED", "FAILED", "CANCELLED"].includes(activeRun.status)}
                    onClick={() => void togglePause()}
                    type="button"
                  >
                    {activeRun.paused ? "Resume run" : "Pause run"}
                  </button>
                  <button
                    className="quiet-button"
                    disabled={["COMPLETED", "FAILED", "CANCELLED"].includes(activeRun.status)}
                    onClick={() => void cancelBenchmark()}
                    type="button"
                  >
                    {activeRun.status === "CANCELLED" ? "Cancelled" : "Cancel run"}
                  </button>
                </div>
              ) : (
                <span className="run-count">No active run</span>
              )}
            </div>
            {consolidatedItems.length > 0 ? (
              <ResultsList items={consolidatedItems} onDelete={handleDeleteResult} onReview={updateReview} />
            ) : (
              <div className="empty-state">
                <div>
                  <div className="empty-state-mark" aria-hidden="true">
                    ◌
                  </div>
                  <h3>A blank canvas is a useful baseline.</h3>
                  <p>
                    Pick a saved scenario or draft a new one, discover your local models, and the dashboard will reveal
                    response quality beside TTFT, throughput, and evaluator notes.
                  </p>
                </div>
              </div>
            )}

            {analysis && analysis.models.length > 0 ? (
              <section className="analysis-panel" aria-label="Model comparison">
                <div className="content-topline">
                  <div>
                    <p className="section-label">Aggregated across {analysis.runs} run{analysis.runs === 1 ? "" : "s"}</p>
                    <h2>Which model answers best, on repeat?</h2>
                  </div>
                  {analysis.bestModel ? (
                    <span className="best-model">
                      Best pick: <strong>{analysis.bestModel.modelName}</strong> · ★ {analysis.bestModel.averageStars}/5
                    </span>
                  ) : null}
                </div>
                <div className="analysis-table">
                  <div className="analysis-row analysis-head">
                    <span>Model</span>
                    <span>Samples</span>
                    <span>Score distribution</span>
                    <span>Avg</span>
                    <span>TTFT</span>
                    <span>Tok/s</span>
                    <span>Output</span>
                  </div>
                  {analysis.models.map((model) => (
                    <div className="analysis-row" key={model.modelName}>
                      <strong>{model.modelName}</strong>
                      <span>
                        {model.evaluatedSamples} evaluated{model.failures > 0 ? ` · ${model.failures} failed` : ""}
                      </span>
                      <span className="star-distribution">
                        {[1, 2, 3, 4, 5].map((star) =>
                          (model.distribution[star] ?? 0) > 0 ? (
                            <span className="star-count" key={star}>
                              {star}★ ×{model.distribution[star]}
                            </span>
                          ) : null,
                        )}
                        {model.evaluatedSamples === 0 ? <span className="run-count">no evaluations yet</span> : null}
                      </span>
                      <span>{model.averageStars === null ? "--" : `${model.averageStars}/5`}</span>
                      <span>{model.averageTtftMs === null ? "--" : `${model.averageTtftMs} ms`}</span>
                      <span>{model.averageTokPerSec === null ? "--" : model.averageTokPerSec}</span>
                      <span>{model.averageOutputTokens === null ? "--" : model.averageOutputTokens}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {history.length > 0 ? (
              <section className="history-panel" aria-label="Benchmark history">
                <div className="content-topline">
                  <div>
                    <p className="section-label">Archive</p>
                    <h2>
                      Previous benchmark runs <span className="history-total">{historyTotal}</span>
                    </h2>
                  </div>
                  <div className="history-filters">
                    <input
                      aria-label="Filter benchmark history by keyword"
                      className="history-filter"
                      onChange={(event) => setHistoryFilter(event.target.value)}
                      placeholder="Keyword..."
                      type="search"
                      value={historyFilter}
                    />
                    <input
                      aria-label="Filter benchmark history by date"
                      className="history-filter"
                      onChange={(event) => setHistoryDate(event.target.value)}
                      type="date"
                      value={historyDate}
                    />
                    <select
                      aria-label="Filter benchmark history by model"
                      className="history-filter"
                      onChange={(event) => setHistoryModel(event.target.value)}
                      value={historyModel}
                    >
                      <option value="">All models</option>
                      {historyModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter benchmark history by score"
                      className="history-filter"
                      onChange={(event) => setHistoryScore(event.target.value)}
                      value={historyScore}
                    >
                      <option value="">Any score</option>
                      {[1, 2, 3, 4, 5].map((score) => (
                        <option key={score} value={score}>
                          {score} stars
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="history-list">
                  {history
                    .filter((run) =>
                      matchesHistory(run, { keyword: historyFilter, date: historyDate, model: historyModel, score: historyScore }),
                    )
                    .map((run) => (
                      <button
                        className="history-row"
                        key={run.id}
                        onClick={() => {
                          setActiveRun(run);
                          if (run.scenarioId && scenarios.some((scenario) => scenario.id === run.scenarioId)) {
                            loadScenario(run.scenarioId);
                          }
                        }}
                        type="button"
                      >
                        <span>{new Date(run.createdAt).toLocaleString()}</span>
                        <strong>{run.models.join(", ")}</strong>
                        <span>{run.status}</span>
                      </button>
                    ))}
                </div>
              </section>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="workspace">
          <aside className="panel controls" aria-label="Settings">
            <div className="controls-header">
              <div>
                <p className="section-label">Workspace</p>
                <h2>Global settings</h2>
              </div>
            </div>

            <section className="control-section">
              <div className="field">
                <label htmlFor="ollama-url">Ollama server</label>
                <input
                  className="input"
                  id="ollama-url"
                  onChange={(event) => setOllamaUrl(event.target.value)}
                  type="url"
                  value={ollamaUrl}
                />
              </div>
            </section>

            <section className="control-section">
              <p className="section-label">Frontier evaluator</p>
              <div className="field">
                <label htmlFor="evaluator-url">OpenAI-compatible endpoint</label>
                <input
                  className="input"
                  data-lpignore="true"
                  id="evaluator-url"
                  onChange={(event) => setEvaluatorBaseUrl(event.target.value)}
                  placeholder="https://api.example.com/v1"
                  type="url"
                  value={evaluatorBaseUrl}
                />
              </div>
              <div className="field">
                <label htmlFor="evaluator-key">API key</label>
                <input
                  className="input"
                  data-lpignore="true"
                  id="evaluator-key"
                  onChange={(event) => setEvaluatorApiKey(event.target.value)}
                  placeholder="Encrypted when persistence is enabled"
                  type="password"
                  value={evaluatorApiKey}
                />
              </div>
              <div className="field">
                <label htmlFor="evaluator-model">Judge model</label>
                <input
                  className="input"
                  data-lpignore="true"
                  id="evaluator-model"
                  onChange={(event) => setEvaluatorModel(event.target.value)}
                  placeholder="gpt-4o-mini"
                  type="text"
                  value={evaluatorModel}
                />
              </div>
              {evaluatorKeyConfigured ? (
                <p className="saved-secret">A saved evaluator key is available and never shown here.</p>
              ) : null}
            </section>

            <section className="control-section">
              <p className="section-label">Generation parameters</p>
              <div className="parameters">
                <ParameterInput
                  label="Temperature"
                  name="temperature"
                  onChange={(value) => setParameters((current) => ({ ...current, temperature: value }))}
                  value={parameters.temperature}
                />
                <ParameterInput
                  label="Context"
                  name="num-ctx"
                  onChange={(value) => setParameters((current) => ({ ...current, numCtx: value }))}
                  value={parameters.numCtx}
                />
                <ParameterInput
                  label="Top-P"
                  name="top-p"
                  onChange={(value) => setParameters((current) => ({ ...current, topP: value }))}
                  value={parameters.topP}
                />
                <ParameterInput
                  label="Repeat penalty"
                  name="repeat-penalty"
                  onChange={(value) => setParameters((current) => ({ ...current, repeatPenalty: value }))}
                  value={parameters.repeatPenalty}
                />
                <ParameterInput
                  label="Max tokens"
                  name="num-predict"
                  onChange={(value) => setParameters((current) => ({ ...current, numPredict: value }))}
                  value={parameters.numPredict}
                />
              </div>
            </section>

            <section className="control-section">
              <p className="section-label">Saved state</p>
              <p className="saved-secret">
                The benchmark always reuses the evaluator configuration stored here unless the run overrides it.
              </p>
            </section>

            {notice ? <div className="notice">{notice}</div> : null}
            <div className="settings-actions">
              <button
                className="quiet-button"
                disabled={isSavingSettings}
                onClick={() => void saveSettings()}
                type="button"
              >
                {isSavingSettings ? "Saving..." : "Save global settings"}
              </button>
              {evaluatorKeyConfigured ? (
                <button
                  className="quiet-button"
                  disabled={isSavingSettings}
                  onClick={() => void saveSettings(true)}
                  type="button"
                >
                  Clear saved key
                </button>
              ) : null}
            </div>
          </aside>

          <section className="content" aria-label="Settings summary">
            <div className="content-topline">
              <div>
                <p className="section-label">Configuration</p>
                <h2>What the next benchmark will use</h2>
              </div>
            </div>
            <div className="settings-summary">
              <div className="summary-row">
                <span>Ollama endpoint</span>
                <strong>{ollamaUrl || "Not configured"}</strong>
              </div>
              <div className="summary-row">
                <span>Judge endpoint</span>
                <strong>{evaluatorBaseUrl || "Not configured — evaluations will be skipped"}</strong>
              </div>
              <div className="summary-row">
                <span>Judge model</span>
                <strong>{evaluatorModel || "—"}</strong>
              </div>
              <div className="summary-row">
                <span>Judge API key</span>
                <strong>{evaluatorKeyConfigured ? "Saved (hidden)" : "Not set"}</strong>
              </div>
              <div className="summary-row">
                <span>Parameters</span>
                <strong>
                  temp {parameters.temperature} · ctx {parameters.numCtx} · top-p {parameters.topP} · rep{" "}
                  {parameters.repeatPenalty} · max {parameters.numPredict}
                </strong>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

async function fetchScenarioAnalysis(
  scenarioId: string,
  systemPrompt: string,
  userMessages: string[],
): Promise<ScenarioAnalysis | null> {
  const params = new URLSearchParams();
  if (scenarioId) {
    params.set("scenarioId", scenarioId);
  } else {
    params.set("systemPrompt", systemPrompt);
    params.set("userMessages", JSON.stringify(userMessages));
  }
  const response = await fetch(`/api/analysis?${params}`);
  if (!response.ok) return null;
  return (await response.json()) as ScenarioAnalysis;
}

type ConsolidatedItem = {
  runId: string;
  runLabel: string;
  result: ModelResult;
};

function buildConsolidatedItems(historical: ConsolidatedResult[], activeRun: TestRun | null): ConsolidatedItem[] {
  const byId = new Map<string, ConsolidatedItem>();
  for (const entry of historical) {
    byId.set(entry.result.id, { runId: entry.runId, runLabel: runDateLabel(entry.runCreatedAt), result: entry.result });
  }
  if (activeRun) {
    for (const result of activeRun.results) {
      byId.set(result.id, { runId: activeRun.id, runLabel: runDateLabel(activeRun.createdAt), result });
    }
  }
  return [...byId.values()];
}

function runDateLabel(timestamp: string) {
  return new Date(timestamp).toLocaleString();
}

function clampSamples(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.min(10, Math.max(1, parsed));
}

type ResultScoreSummary = {
  average: number;
  averageOverallRating: number;
  averageGrammarRating: number | null;
  averageComplianceRating: number | null;
  averageAccuracyRating: number | null;
};

type ResultTelemetrySummary = {
  averageOutputTokens: number | null;
  averageTtftMs: number | null;
  averageTokPerSec: number | null;
  averageTotalDurationMs: number | null;
};

type ResultModelGroup = {
  modelName: string;
  items: ConsolidatedItem[];
  scoreSummary: ResultScoreSummary | null;
};

function groupResultsByModel(results: ConsolidatedItem[]): ResultModelGroup[] {
  const groups = new Map<string, ConsolidatedItem[]>();
  for (const item of results) {
    const group = groups.get(item.result.modelName) ?? [];
    group.push(item);
    groups.set(item.result.modelName, group);
  }
  return [...groups.entries()]
    .map(([modelName, groupedItems]) => ({
      modelName,
      items: groupedItems,
      scoreSummary: getResultScoreSummary(groupedItems),
    }))
    .sort((groupA, groupB) => {
      if (groupA.scoreSummary && groupB.scoreSummary) {
        return (
          groupB.scoreSummary.averageOverallRating - groupA.scoreSummary.averageOverallRating ||
          groupA.modelName.localeCompare(groupB.modelName)
        );
      }
      if (groupA.scoreSummary) return -1;
      if (groupB.scoreSummary) return 1;
      return groupA.modelName.localeCompare(groupB.modelName);
    });
}

function getResultScoreSummary(items: ConsolidatedItem[]): ResultScoreSummary | null {
  const evaluations = items
    .map((item) => item.result.evaluation)
    .filter((evaluation): evaluation is NonNullable<ModelResult["evaluation"]> => evaluation !== null);
  const scores = evaluations
    .map((evaluation) => evaluation.scoreStars)
    .filter((score): score is number => typeof score === "number");
  const average = averageNumbers(scores);
  if (average === null) return null;

  const averageGrammarRating = averageNumbers(evaluations.map((evaluation) => evaluation.grammarRating));
  const averageComplianceRating = averageNumbers(evaluations.map((evaluation) => evaluation.complianceRating));
  const averageAccuracyRating = averageNumbers(evaluations.map((evaluation) => evaluation.accuracyRating));

  return {
    average,
    averageOverallRating:
      averageNumbers([average, averageGrammarRating, averageComplianceRating, averageAccuracyRating]) ?? average,
    averageGrammarRating,
    averageComplianceRating,
    averageAccuracyRating,
  };
}

function getResultTelemetrySummary(items: ConsolidatedItem[]): ResultTelemetrySummary {
  const completed = items.map((item) => item.result).filter((result) => result.status === "COMPLETED");
  return {
    averageOutputTokens: averageNumbers(completed.map((result) => result.outputTokens)),
    averageTtftMs: averageNumbers(completed.map((result) => result.ttftMs)),
    averageTokPerSec: averageNumbers(completed.map((result) => result.tokPerSec)),
    averageTotalDurationMs: averageNumbers(completed.map((result) => result.totalDurationMs)),
  };
}

function averageNumbers(values: Array<number | null>) {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return null;
  return Number((present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(2));
}

function renderStars(value: number) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

function ResultsList({
  items,
  onDelete,
  onReview,
}: {
  items: ConsolidatedItem[];
  onDelete: (runId: string, resultId: string) => void;
  onReview: (result: ModelResult, status: HumanStatus) => void;
}) {
  const results = items.map((item) => item.result);
  const modelGroups = groupResultsByModel(items);
  const resultNumbers = new Map(results.map((result, index) => [result.id, index + 1]));
  const [expandedResults, setExpandedResults] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  function isResultOpen(resultId: string) {
    return expandedResults.has(resultId);
  }

  const completedCount = results.filter((result) => result.status === "COMPLETED").length;
  const allExpanded = results.length > 0 && results.every((result) => isResultOpen(result.id));
  const allGroupsCollapsed = modelGroups.length > 0 && modelGroups.every((group) => collapsedGroups.has(group.modelName));

  function toggleResult(resultId: string, open: boolean) {
    setExpandedResults((current) => {
      const next = new Set(current);
      if (open) next.add(resultId);
      else next.delete(resultId);
      return next;
    });
  }

  function toggleAll() {
    setExpandedResults(allExpanded ? new Set() : new Set(results.map((result) => result.id)));
  }

  function toggleGroup(modelName: string, collapsed: boolean) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (collapsed) next.add(modelName);
      else next.delete(modelName);
      return next;
    });
  }

  function toggleAllGroups() {
    setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(modelGroups.map((group) => group.modelName)));
  }

  return (
    <section className="results-list-shell" aria-label="Benchmark test list">
      <div className="results-list-head">
        <div>
          <p className="section-label">Test list</p>
          <p className="results-list-description">
            Responses are grouped by model across all runs. Open a test to inspect the full answer, telemetry, and review notes.
          </p>
        </div>
        <div className="results-list-actions">
          <span className="run-count">
            {completedCount}/{results.length} completed · {modelGroups.length} model{modelGroups.length === 1 ? "" : "s"}
          </span>
          <button className="quiet-button" onClick={toggleAllGroups} type="button">
            {allGroupsCollapsed ? "Expand groups" : "Collapse groups"}
          </button>
          <button className="quiet-button" onClick={toggleAll} type="button">
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>
      <div className="results-list">
        {modelGroups.map((group, groupIndex) => (
          <ModelResultGroup
            key={group.modelName}
            groupIndex={groupIndex}
            modelName={group.modelName}
            onDelete={onDelete}
            onReview={onReview}
            onToggleCollapsed={toggleGroup}
            onToggle={toggleResult}
            openResult={isResultOpen}
            resultNumbers={resultNumbers}
            scoreSummary={group.scoreSummary}
            collapsed={collapsedGroups.has(group.modelName)}
            items={group.items}
          />
        ))}
      </div>
    </section>
  );
}

function ModelResultGroup({
  groupIndex,
  modelName,
  onDelete,
  onReview,
  onToggleCollapsed,
  onToggle,
  openResult,
  resultNumbers,
  scoreSummary,
  collapsed,
  items,
}: {
  groupIndex: number;
  modelName: string;
  onDelete: (runId: string, resultId: string) => void;
  onReview: (result: ModelResult, status: HumanStatus) => void;
  onToggleCollapsed: (modelName: string, collapsed: boolean) => void;
  onToggle: (resultId: string, open: boolean) => void;
  openResult: (resultId: string) => boolean;
  resultNumbers: Map<string, number>;
  scoreSummary: ResultScoreSummary | null;
  collapsed: boolean;
  items: ConsolidatedItem[];
}) {
  const completedCount = items.filter((item) => item.result.status === "COMPLETED").length;
  const resultsId = `model-group-results-${groupIndex}`;
  const telemetrySummary = getResultTelemetrySummary(items);

  return (
    <section className="model-result-group" data-open={!collapsed} aria-labelledby={`model-group-${groupIndex}`}>
      <header
        className="model-group-header"
        onClick={() => onToggleCollapsed(modelName, !collapsed)}
      >
        <div className="model-group-identity">
          <p className="model-group-kicker">Model group</p>
          <h3 id={`model-group-${groupIndex}`}>{modelName}</h3>
        </div>
        <div className="model-group-meta">
          <span className="run-count">
            {items.length} test{items.length === 1 ? "" : "s"} · {completedCount} completed
          </span>
          <ModelScore summary={scoreSummary} telemetry={telemetrySummary} />
          <button
            aria-controls={resultsId}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${modelName} results`}
            className="quiet-button model-group-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapsed(modelName, !collapsed);
            }}
            type="button"
          >
            <span className="test-chevron" aria-hidden="true">
              ↓
            </span>
          </button>
        </div>
      </header>
      <div className="model-group-results" hidden={collapsed} id={resultsId}>
        {items.map((item) => (
          <ResultItem
            key={item.result.id}
            onDelete={onDelete}
            onReview={onReview}
            onToggle={onToggle}
            open={openResult(item.result.id)}
            result={item.result}
            resultNumber={resultNumbers.get(item.result.id) ?? 0}
            runId={item.runId}
            runLabel={item.runLabel}
            sampleLabel={`Sample ${item.result.sampleIndex + 1}`}
          />
        ))}
      </div>
    </section>
  );
}

function ModelScore({ summary, telemetry }: { summary: ResultScoreSummary | null; telemetry: ResultTelemetrySummary }) {
  if (!summary) {
    return (
      <div className="model-score model-score-empty">
        <span>No scores yet</span>
      </div>
    );
  }

  return (
    <div
      className="model-score"
      title={`Overall ${summary.averageOverallRating.toFixed(1)} / 5 · Evaluator ${summary.average.toFixed(1)} / 5`}
    >
      <div className="model-score-body">
        <div className="model-score-telemetry">
          <span className="model-score-ratings-label">Avg telemetry</span>
          <div className="model-score-telemetry-grid">
            <span className="model-score-rating">
              <span>Output</span>
              <strong>{formatTelemetryAverage(telemetry.averageOutputTokens, 0, " tok")}</strong>
            </span>
            <span className="model-score-rating">
              <span>TTFT</span>
              <strong>{formatTelemetryAverage(telemetry.averageTtftMs, 1, " ms")}</strong>
            </span>
            <span className="model-score-rating">
              <span>Tok/s</span>
              <strong>{formatTelemetryAverage(telemetry.averageTokPerSec, 1)}</strong>
            </span>
            <span className="model-score-rating">
              <span>Total</span>
              <strong>{formatTelemetryAverage(telemetry.averageTotalDurationMs, 1, " ms")}</strong>
            </span>
          </div>
        </div>
        <div className="model-score-ratings">
          <span className="model-score-ratings-label">Average ratings</span>
          <div className="model-score-rating-grid">
            <span className="model-score-rating">
              <span>Evaluator</span>
              <strong>{formatRatingAverage(summary.average)}</strong>
            </span>
            <span className="model-score-rating">
              <span>Grammar</span>
              <strong>{formatRatingAverage(summary.averageGrammarRating)}</strong>
            </span>
            <span className="model-score-rating">
              <span>Compliance</span>
              <strong>{formatRatingAverage(summary.averageComplianceRating)}</strong>
            </span>
            <span className="model-score-rating">
              <span>Accuracy</span>
              <strong>{formatRatingAverage(summary.averageAccuracyRating)}</strong>
            </span>
          </div>
        </div>
        <div className="model-score-primary">
          <span className="model-score-caption">Overall</span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="stars model-score-stars" aria-hidden="true">
              {renderStars(summary.averageOverallRating)}
            </span>
            <strong>{summary.averageOverallRating.toFixed(1)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRatingAverage(value: number | null) {
  return value === null ? "--" : `${value.toFixed(2)}/5`;
}

function formatTelemetryAverage(value: number | null, decimals: number, suffix = "") {
  return value === null ? "--" : `${value.toFixed(decimals)}${suffix}`;
}

function ResultItem({
  onDelete,
  onReview,
  onToggle,
  open,
  result,
  runId,
  runLabel,
  sampleLabel,
  resultNumber,
}: {
  onDelete?: (runId: string, resultId: string) => void;
  onReview: (result: ModelResult, status: HumanStatus) => void;
  onToggle: (resultId: string, open: boolean) => void;
  open: boolean;
  result: ModelResult;
  runId?: string;
  runLabel?: string;
  sampleLabel?: string;
  resultNumber: number;
}) {
  const [notes, setNotes] = useState(result.humanNotes);
  const statusClass = result.status.toLowerCase();
  const score = result.evaluation?.scoreStars ?? 0;
  const detailsId = `result-details-${result.id}`;

  return (
    <details
      className={`test-item ${statusClass}`}
      onToggle={(event) => onToggle(result.id, event.currentTarget.open)}
      open={open}
    >
      <summary aria-controls={detailsId} className="test-summary">
        <span className="test-index" aria-hidden="true">
          {String(resultNumber).padStart(2, "0")}
        </span>
        <span className="test-identity">
          <span className="test-kicker">
            {sampleLabel ?? "Test"}
            {runLabel ? ` · run ${runLabel}` : ""} · {evaluationLabel(result.evalStatus)}
          </span>
          <strong>{result.modelName}</strong>
        </span>
        <span className={`test-preview${result.responseText ? "" : " placeholder"}`}>
          {result.responseText
            ? (() => {
                const lines: [string, string][] = [
                  ["Tokens", result.outputTokens !== null ? `${result.outputTokens}` : null],
                  ["TTFT", result.ttftMs !== null ? `${result.ttftMs} ms` : null],
                  ["Tok/s", result.tokPerSec !== null ? `${result.tokPerSec.toFixed(1)}` : null],
                  ["Total", result.totalDurationMs !== null ? `${result.totalDurationMs} ms` : null],
                ].filter(([, v]) => v !== null) as [string, string][];
                return lines.length > 0
                  ? lines.map(([label, value], i) => (
                      <span key={i} className="test-preview-row">
                        <span className="test-preview-name">{label}</span>
                        <span>{value}</span>
                      </span>
                    ))
                  : "Response captured";
              })()
            : statusCopy(result.status)}
        </span>
        <span className="test-score">
          <span className="test-score-row">
            <span className="test-score-name">Evaluator</span>
            <span className="stars" aria-label={`${score} out of 5 stars`}>
              {renderStars(score)}
            </span>
          </span>
          {result.evaluation ? (
            <>
              <span className="test-score-row">
                <span className="test-score-name">Grammar</span>
                <span className="stars" aria-label={`Grammar ${result.evaluation.grammarRating ?? "—"} out of 5`}>
                  {result.evaluation.grammarRating !== null ? renderStars(result.evaluation.grammarRating) : "—"}
                </span>
              </span>
              <span className="test-score-row">
                <span className="test-score-name">Compliance</span>
                <span className="stars" aria-label={`Compliance ${result.evaluation.complianceRating ?? "—"} out of 5`}>
                  {result.evaluation.complianceRating !== null ? renderStars(result.evaluation.complianceRating) : "—"}
                </span>
              </span>
              <span className="test-score-row">
                <span className="test-score-name">Accuracy</span>
                <span className="stars" aria-label={`Accuracy ${result.evaluation.accuracyRating ?? "—"} out of 5`}>
                  {result.evaluation.accuracyRating !== null ? renderStars(result.evaluation.accuracyRating) : "—"}
                </span>
              </span>
            </>
          ) : null}
        </span>
        <span className={`status test-status ${statusClass}`}>{result.status}</span>
        <span className="test-chevron" aria-hidden="true">
          ↓
        </span>
      </summary>

      <div className="test-details" id={detailsId}>
        {onDelete && runId ? (
          <div className="detail-actions">
            <button
              className="danger-button"
              onClick={() => {
                if (window.confirm(`Delete ${sampleLabel} from ${result.modelName}? This removes it from the results permanently.`)) {
                  onDelete(runId, result.id);
                }
              }}
              type="button"
            >
              Delete sample
            </button>
          </div>
        ) : null}
        <div className="test-details-main">
          <section className="detail-section response-section">
            <div className="detail-section-heading">
              <div>
                <p className="section-label">Model response</p>
                <h3>{result.modelName}</h3>
              </div>
              <span className="test-detail-label">
                {sampleLabel}
                {runLabel ? ` · run ${runLabel}` : ""}
              </span>
            </div>
            <div className={`response-full${result.responseText ? "" : " placeholder"}`}>
              {result.responseText ?? statusCopy(result.status)}
            </div>
            {result.turns.length > 0 ? (
              <div className="turn-list">
                {result.turns.map((turn) => (
                  <div className="turn-card" key={turn.id}>
                    <div>
                      <span className="detail-label">Turn {turn.stepOrder}</span>
                      <p>{turn.userMessage}</p>
                    </div>
                    <div>
                      <span className="detail-label">Response</span>
                      <p>{turn.responseText}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="detail-section telemetry-section">
            <div className="detail-section-heading">
              <div>
                <p className="section-label">Run telemetry</p>
                <h3>How it answered</h3>
              </div>
              <span className={`status ${result.evalStatus.toLowerCase()}`}>{result.evalStatus}</span>
            </div>
            <div className="detail-metrics">
              <Metric label="TTFT" value={formatMetric(result.ttftMs, " ms")} />
              <Metric label="Prompt tokens" value={formatMetric(result.inputTokens)} />
              <Metric label="Output tokens" value={formatMetric(result.outputTokens)} />
              <Metric label="Tokens / sec" value={formatMetric(result.tokPerSec)} />
              <Metric label="Total time" value={formatMetric(result.totalDurationMs, " ms")} />
            </div>
          </section>
        </div>

        {result.evaluation ? (
          <section className="detail-section evaluation-section">
            <div className="detail-section-heading">
              <div>
                <p className="section-label">Automated review</p>
                <h3>{result.evaluation.feedbackText}</h3>
              </div>
              <span className="stars" aria-label="Automated evaluator score">
                {renderStars(score)}
              </span>
            </div>
            <div className="rating-grid">
              <Metric label="Grammar" value={formatRating(result.evaluation.grammarRating)} />
              <Metric label="Compliance" value={formatRating(result.evaluation.complianceRating)} />
              <Metric label="Accuracy" value={formatRating(result.evaluation.accuracyRating)} />
            </div>
            <div className="evaluation-copy">
              <span>Grammar: {result.evaluation.grammarAnalysis}</span>
              <span>Instruction fit: {result.evaluation.complianceAnalysis}</span>
              <span>Accuracy: {result.evaluation.accuracyAnalysis}</span>
            </div>
          </section>
        ) : null}

        {result.errorMessage ? <div className="notice">{result.errorMessage}</div> : null}

        {result.status === "COMPLETED" ? (
          <section className="detail-section review-section">
            <div className="detail-section-heading">
              <div>
                <p className="section-label">Human review</p>
                <h3>Would you keep this answer?</h3>
              </div>
              <span className="run-count">Current: {result.humanStatus}</span>
            </div>
            <textarea
              aria-label={`Human notes for ${result.modelName}`}
              className="review-notes"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add a note for the final decision..."
              value={notes}
            />
            <div className="review-actions">
              <button className="quiet-button" onClick={() => onReview({ ...result, humanNotes: notes }, "APPROVED")} type="button">
                Approve
              </button>
              <button className="quiet-button" onClick={() => onReview({ ...result, humanNotes: notes }, "REJECTED")} type="button">
                Reject
              </button>
              <button className="quiet-button" onClick={() => onReview({ ...result, humanNotes: notes }, "REVIEWED")} type="button">
                Reviewed
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function formatMetric(value: number | null, suffix = "") {
  return value === null ? "--" : `${value}${suffix}`;
}

function formatRating(value: number | null) {
  return value === null ? "--/5" : `${value}/5`;
}

function evaluationLabel(status: ModelResult["evalStatus"]) {
  switch (status) {
    case "PENDING":
      return "Waiting for judge";
    case "RUNNING":
      return "Judge running";
    case "COMPLETED":
      return "Evaluated";
    case "FAILED":
      return "Judge failed";
    default:
      return "No judge";
  }
}

function statusCopy(status: ModelResult["status"]) {
  switch (status) {
    case "PENDING":
      return "Waiting in the local work queue...";
    case "INFERRING":
      return "Streaming response from Ollama...";
    case "EVALUATING":
      return "The local answer is ready; the judge is reading it...";
    case "FAILED":
      return "This model did not complete the benchmark.";
    case "CANCELLED":
      return "This model was cancelled with the run.";
    default:
      return "No response recorded.";
  }
}

function matchesHistory(
  run: TestRun,
  filters: { keyword: string; date: string; model: string; score: string },
) {
  const query = filters.keyword.trim().toLowerCase();
  if (query && !JSON.stringify(run).toLowerCase().includes(query)) return false;
  if (filters.date && localDateForBrowser(run.createdAt) !== filters.date) return false;
  if (filters.model && !run.models.includes(filters.model)) return false;
  if (filters.score && !run.results.some((result) => result.evaluation?.scoreStars === Number(filters.score))) return false;
  return true;
}

function localDateForBrowser(timestamp: string) {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function ParameterInput({
  label,
  name,
  onChange,
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="parameter">
      <label htmlFor={name}>{label}</label>
      <input id={name} min="0" onChange={(event) => onChange(event.target.value)} step="any" type="number" value={value} />
    </div>
  );
}
