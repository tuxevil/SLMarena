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

type ScenarioAnalysis = {
  scenarioKey: string;
  runs: number;
  models: ModelAggregate[];
  bestModel: { modelName: string; averageStars: number } | null;
};

type SettingsPayload = {
  settings?: {
    ollamaUrl: string;
    evaluatorBaseUrl: string;
    evaluatorModel: string;
    evaluatorApiKeyConfigured: boolean;
    defaultParameters?: { temperature: number; numCtx: number; topP: number; repeatPenalty: number; numPredict: number };
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
    const raw = localStorage.getItem("compare_slm_settings");
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

  useEffect(() => {
    void fetch("/api/settings")
      .then((response) => response.json() as Promise<SettingsPayload>)
      .then((payload) => {
        if (payload.settings?.ollamaUrl || payload.settings?.evaluatorBaseUrl || payload.settings?.evaluatorModel) {
          setOllamaUrl(payload.settings.ollamaUrl);
          setEvaluatorBaseUrl(payload.settings.evaluatorBaseUrl);
          setEvaluatorModel(payload.settings.evaluatorModel);
          setEvaluatorKeyConfigured(payload.settings.evaluatorApiKeyConfigured);
          if (payload.settings.defaultParameters) {
            setParameters({
              temperature: String(payload.settings.defaultParameters.temperature),
              numCtx: String(payload.settings.defaultParameters.numCtx),
              topP: String(payload.settings.defaultParameters.topP),
              repeatPenalty: String(payload.settings.defaultParameters.repeatPenalty),
              numPredict: String(payload.settings.defaultParameters.numPredict),
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
  }, [historyDate, historyFilter, historyModel, historyScore]);

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
  }, [selectedScenarioId, systemPrompt, messages]);

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
            "compare_slm_settings",
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
          defaultParameters: {
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

  const historyModels = [...new Set(history.flatMap((run) => run.models))].sort();

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Local model quality lab / 01</p>
          <h1>Compare the answer, not the promise.</h1>
          <p className="lede">
            Run identical conversations across your Ollama models, capture the hidden latency story, then let a frontier
            judge explain what made one answer better.
          </p>
        </div>
        <div className="connection-pill">
          <span className="connection-dot" aria-hidden="true" />
          Ollama endpoint: {ollamaUrl}
        </div>
      </header>

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
                <label htmlFor="samples-per-model">Muestras por modelo (respuestas por ejecución)</label>
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
            {activeRun ? (
              <div className="results-grid">
                {groupResultsByModel(activeRun.results).map(([modelName, results]) => (
                  <ModelGroup key={modelName} modelName={modelName} onReview={updateReview} results={results} />
                ))}
              </div>
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
                      <button className="history-row" key={run.id} onClick={() => setActiveRun(run)} type="button">
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

function groupResultsByModel(results: ModelResult[]): Array<[string, ModelResult[]]> {  const map = new Map<string, ModelResult[]>();
  for (const result of results) {
    const list = map.get(result.modelName) ?? [];
    list.push(result);
    map.set(result.modelName, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function clampSamples(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.min(10, Math.max(1, parsed));
}

function ModelGroup({
  modelName,
  onReview,
  results,
}: {
  modelName: string;
  onReview: (result: ModelResult, status: HumanStatus) => void;
  results: ModelResult[];
}) {
  const scored = results.filter((result) => result.evaluation?.scoreStars != null);
  const average = scored.length > 0 ? scored.reduce((sum, result) => sum + (result.evaluation?.scoreStars ?? 0), 0) / scored.length : null;
  return (
    <div className="model-group">
      <div className="model-group-header">
        <div>
          <p className="card-kicker">Local model</p>
          <h3>{modelName}</h3>
        </div>
        <div className="model-group-summary">
          <span className="run-count">{results.length} sample{results.length === 1 ? "" : "s"}</span>
          {average !== null ? (
            <span className="stars" aria-label={`${average.toFixed(1)} average stars`}>
              {"★".repeat(Math.round(average)) + "☆".repeat(5 - Math.round(average))}
              <span className="average-label"> {average.toFixed(1)}</span>
            </span>
          ) : (
            <span className="stars">☆☆☆☆☆</span>
          )}
        </div>
      </div>
      <div className="model-group-samples">
        {results
          .slice()
          .sort((a, b) => a.sampleIndex - b.sampleIndex)
          .map((result) => (
            <ResultCard
              key={result.id}
              onReview={onReview}
              result={result}
              sampleLabel={`Sample ${result.sampleIndex + 1}/${results.length}`}
            />
          ))}
      </div>
    </div>
  );
}

function ResultCard({
  onReview,
  result,
  sampleLabel,
}: {
  onReview: (result: ModelResult, status: HumanStatus) => void;
  result: ModelResult;
  sampleLabel?: string;
}) {
  const [notes, setNotes] = useState(result.humanNotes);
  const statusClass = result.status.toLowerCase();
  const score = result.evaluation?.scoreStars ?? 0;
  return (
    <article className="result-card">
      <div className="result-card-top">
        <div>
          <p className="card-kicker">{sampleLabel ?? "Local model"}</p>
          <h3>{result.modelName}</h3>
        </div>
        <span className={`status ${statusClass}`}>{result.status}</span>
      </div>
      <p className={`response-preview${result.responseText ? "" : " placeholder"}`}>
        {result.responseText ?? statusCopy(result.status)}
      </p>
      <div className="metric-row">
        <Metric label="TTFT" value={formatMetric(result.ttftMs, "ms")} />
        <Metric label="Prompt" value={formatMetric(result.inputTokens)} />
        <Metric label="Output" value={formatMetric(result.outputTokens)} />
        <Metric label="Tok/s" value={formatMetric(result.tokPerSec)} />
        <Metric label="Total" value={formatMetric(result.totalDurationMs, "ms")} />
      </div>
      <div className="result-card-footer">
        <span>{result.evalStatus === "SKIPPED" ? "No judge configured" : result.evalStatus}</span>
        <span className="stars" aria-label={`${score} out of 5 stars`}>
          {score ? "★".repeat(score) + "☆".repeat(5 - score) : "☆☆☆☆☆"}
        </span>
      </div>
      {result.evaluation ? (
        <div className="evaluation-note">
          <strong>{result.evaluation.feedbackText}</strong>
          <div className="rating-grid">
            <Metric label="Grammar" value={formatRating(result.evaluation.grammarRating)} />
            <Metric label="Compliance" value={formatRating(result.evaluation.complianceRating)} />
            <Metric label="Accuracy" value={formatRating(result.evaluation.accuracyRating)} />
          </div>
          <span>Grammar: {result.evaluation.grammarAnalysis}</span>
          <span>Instruction fit: {result.evaluation.complianceAnalysis}</span>
          <span>Accuracy: {result.evaluation.accuracyAnalysis}</span>
        </div>
      ) : null}
      {result.errorMessage ? <div className="notice">{result.errorMessage}</div> : null}
      {result.status === "COMPLETED" ? (
        <div>
          <textarea
            aria-label={`Human notes for ${result.modelName}`}
            className="review-notes"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Final human feedback..."
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
            <span className="run-count">{result.humanStatus}</span>
          </div>
        </div>
      ) : null}
    </article>
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
