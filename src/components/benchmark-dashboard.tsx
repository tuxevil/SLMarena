"use client";

import { useEffect, useState } from "react";
import type { HumanStatus, ModelResult, PromptTemplate, TestRun, TestSuite } from "@/lib/contracts";

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
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a precise technical assistant. Explain trade-offs clearly and do not invent facts.",
  );
  const [messages, setMessages] = useState(["Compare REST and GraphQL for a small internal service."]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [ollamaUrl, setOllamaUrl] = useState(() => getInitialLocalSettings()?.ollamaUrl ?? "http://localhost:11434");
  const [evaluatorBaseUrl, setEvaluatorBaseUrl] = useState(() => getInitialLocalSettings()?.evaluatorBaseUrl ?? "");
  const [evaluatorApiKey, setEvaluatorApiKey] = useState("");
  const [evaluatorModel, setEvaluatorModel] = useState(() => getInitialLocalSettings()?.evaluatorModel ?? "");
  const [evaluatorKeyConfigured, setEvaluatorKeyConfigured] = useState(false);
  const [parameters, setParameters] = useState<ParameterState>(
    () =>
      getInitialLocalSettings()?.parameters ?? {
        temperature: "0.2",
        numCtx: "8192",
        topP: "0.9",
        repeatPenalty: "1.1",
        numPredict: "4096",
      },
  );
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [promptTitle, setPromptTitle] = useState("Current system prompt");
  const [promptTagsText, setPromptTagsText] = useState("");
  const [suiteTemplates, setSuiteTemplates] = useState<TestSuite[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [suiteDescription, setSuiteDescription] = useState("");
  const [suiteTagsText, setSuiteTagsText] = useState("");
  const [history, setHistory] = useState<TestRun[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilter, setHistoryFilter] = useState("");
  const [historyDate, setHistoryDate] = useState("");
  const [historyModel, setHistoryModel] = useState("");
  const [historyScore, setHistoryScore] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/settings")
      .then((response) => response.json() as Promise<{ settings?: { ollamaUrl: string; evaluatorBaseUrl: string; evaluatorModel: string; evaluatorApiKeyConfigured: boolean; defaultParameters?: { temperature: number; numCtx: number; topP: number; repeatPenalty: number; numPredict: number } } }>)
      .then((payload) => {
        if (!payload.settings) return;
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
      })
      .catch(() => undefined);

    void fetch("/api/prompts")
      .then((response) => response.json() as Promise<{ prompts?: PromptTemplate[] }>)
      .then((payload) => setPromptTemplates(payload.prompts ?? []))
      .catch(() => undefined);

    void fetch("/api/suites")
      .then((response) => response.json() as Promise<{ suites?: TestSuite[] }>)
      .then((payload) => setSuiteTemplates(payload.suites ?? []))
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

  useEffect(() => {
    if (!activeRun?.id) return;

    const source = new EventSource(`/api/runs/${activeRun.id}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { run: TestRun };
      setActiveRun(payload.run);
      setHistory((current) => [payload.run, ...current.filter((item) => item.id !== payload.run.id)]);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(payload.run.status)) source.close();
    };
    source.onerror = () => setNotice("Live connection interrupted. The browser will retry automatically.");

    return () => source.close();
  }, [activeRun?.id]);

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

    const hasEvaluatorKey = Boolean(evaluatorApiKey || evaluatorKeyConfigured);
    const hasPartialEvaluator = Boolean(evaluatorBaseUrl || evaluatorApiKey || evaluatorModel) &&
      !(evaluatorBaseUrl && hasEvaluatorKey && evaluatorModel);
    if (hasPartialEvaluator) {
      setNotice("Complete all frontier evaluator fields or leave them empty to skip evaluation.");
      return;
    }

    if (evaluatorKeyConfigured && !evaluatorApiKey && evaluatorBaseUrl && evaluatorModel) {
      if (!(await saveSettings())) return;
    }

    setIsStarting(true);
    setNotice("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ollamaUrl,
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
          evaluator: evaluatorBaseUrl && evaluatorApiKey
            ? { baseUrl: evaluatorBaseUrl, apiKey: evaluatorApiKey, model: evaluatorModel }
            : undefined,
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

  async function savePromptTemplate() {
    const title = window.prompt("Template name", promptTitle);
    if (!title?.trim()) return;
    const response = await fetch("/api/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, systemPrompt, tags: parseTags(promptTagsText) }),
    });
    if (!response.ok) {
      setNotice("Could not save system prompt.");
      return;
    }
    const payload = (await response.json()) as { prompt?: PromptTemplate };
    if (payload.prompt) {
      setPromptTemplates((current) => [payload.prompt!, ...current]);
      setSelectedPromptId(payload.prompt.id);
      setPromptTitle(payload.prompt.title);
      setPromptTagsText(payload.prompt.tags.join(", "));
    }
    setNotice("System prompt saved to the library.");
  }

  async function updatePromptTemplate() {
    if (!selectedPromptId || !promptTitle.trim()) return;
    const response = await fetch(`/api/prompts/${selectedPromptId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: promptTitle, systemPrompt, tags: parseTags(promptTagsText) }),
    });
    const payload = (await response.json()) as { prompt?: PromptTemplate; error?: string };
    if (!response.ok || !payload.prompt) {
      setNotice(payload.error ?? "Could not update system prompt.");
      return;
    }
    setPromptTemplates((current) => current.map((item) => (item.id === payload.prompt!.id ? payload.prompt! : item)));
    setNotice("System prompt updated.");
  }

  async function deletePromptTemplate() {
    if (!selectedPromptId || !window.confirm("Delete this system prompt?")) return;
    const response = await fetch(`/api/prompts/${selectedPromptId}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice("Could not delete system prompt.");
      return;
    }
    setPromptTemplates((current) => current.filter((item) => item.id !== selectedPromptId));
    setSelectedPromptId("");
    setPromptTitle("Current system prompt");
    setPromptTagsText("");
    setNotice("System prompt deleted.");
  }

  async function saveSuiteTemplate() {
    const name = window.prompt("Suite name");
    if (!name?.trim() || messages.some((message) => !message.trim())) return;
    const promptTemplateId = await ensureSystemPrompt(`${name} system prompt`);
    if (!promptTemplateId) return;
    const response = await fetch("/api/suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description: suiteDescription, promptTemplateId, userMessages: messages, tags: parseTags(suiteTagsText) }),
    });
    if (!response.ok) {
      setNotice("Could not save test suite.");
      return;
    }
    const payload = (await response.json()) as { suite?: TestSuite };
    if (payload.suite) {
      setSuiteTemplates((current) => [payload.suite!, ...current]);
      setSelectedSuiteId(payload.suite.id);
    }
    setNotice("Test suite saved to the library.");
  }

  async function updateSuiteTemplate() {
    const suite = suiteTemplates.find((item) => item.id === selectedSuiteId);
    if (!suite || messages.some((message) => !message.trim())) return;
    const promptTemplateId = await ensureSystemPrompt(`${suite.name} system prompt`);
    if (!promptTemplateId) return;
    const response = await fetch(`/api/suites/${suite.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...suite, promptTemplateId, description: suiteDescription, userMessages: messages, tags: parseTags(suiteTagsText) }),
    });
    const payload = (await response.json()) as { suite?: TestSuite; error?: string };
    if (!response.ok || !payload.suite) {
      setNotice(payload.error ?? "Could not update test suite.");
      return;
    }
    setSuiteTemplates((current) => current.map((item) => (item.id === payload.suite!.id ? payload.suite! : item)));
    setNotice("Test suite updated.");
  }

  async function deleteSuiteTemplate() {
    if (!selectedSuiteId || !window.confirm("Delete this test suite?")) return;
    const response = await fetch(`/api/suites/${selectedSuiteId}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice("Could not delete test suite.");
      return;
    }
    setSuiteTemplates((current) => current.filter((item) => item.id !== selectedSuiteId));
    setSelectedSuiteId("");
    setNotice("Test suite deleted.");
  }

  async function ensureSystemPrompt(title: string) {
    const existing = promptTemplates.find((prompt) => prompt.systemPrompt === systemPrompt);
    if (existing) return existing.id;
    const response = await fetch("/api/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, systemPrompt, tags: parseTags(promptTagsText) }),
    });
    const payload = (await response.json()) as { prompt?: PromptTemplate };
    if (!response.ok || !payload.prompt) {
      setNotice("Could not save the suite's system prompt.");
      return null;
    }
    setPromptTemplates((current) => [payload.prompt!, ...current]);
    return payload.prompt.id;
  }

  function loadSuite(suiteId: string) {
    const suite = suiteTemplates.find((item) => item.id === suiteId);
    if (!suite) return;
    setMessages(suite.userMessages);
    setSuiteDescription(suite.description);
    setSuiteTagsText(suite.tags.join(", "));
    if (suite.promptTemplateId) {
      const prompt = promptTemplates.find((item) => item.id === suite.promptTemplateId);
      if (prompt) {
        setSelectedPromptId(prompt.id);
        setPromptTitle(prompt.title);
        setPromptTagsText(prompt.tags.join(", "));
        setSystemPrompt(prompt.systemPrompt);
      }
    }
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
          Ollama endpoint not checked
        </div>
      </header>

      <div className="workspace">
        <aside className="panel controls" aria-label="Benchmark configuration">
          <div className="controls-header">
            <div>
              <p className="section-label">Test setup</p>
              <h2>Shape the challenge</h2>
            </div>
            <span className="card-kicker">Draft</span>
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
            <button className="quiet-button" disabled={isDiscovering} onClick={discoverModels} type="button">
              {isDiscovering ? "Checking endpoint..." : "Discover models ↗"}
            </button>
          </section>

          <section className="control-section">
            <div className="field">
              <label htmlFor="prompt-library">Prompt library</label>
              <select
                className="input"
                id="prompt-library"
                onChange={(event) => {
                  const prompt = promptTemplates.find((item) => item.id === event.target.value);
                  setSelectedPromptId(event.target.value);
                  if (prompt) {
                    setSystemPrompt(prompt.systemPrompt);
                    setPromptTitle(prompt.title);
                    setPromptTagsText(prompt.tags.join(", "));
                  }
                }}
                value={selectedPromptId}
              >
                <option value="">Choose a saved system prompt</option>
                {promptTemplates.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="result-card-top">
                <label htmlFor="system-prompt">System prompt</label>
                <div className="conversation-actions">
                  <button className="quiet-button" onClick={savePromptTemplate} type="button">
                    Save template
                  </button>
                  {selectedPromptId ? (
                    <>
                      <button className="quiet-button" onClick={updatePromptTemplate} type="button">
                        Update
                      </button>
                      <button className="quiet-button" onClick={deletePromptTemplate} type="button">
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <input
                className="input"
                id="prompt-title"
                onChange={(event) => setPromptTitle(event.target.value)}
                placeholder="Prompt title"
                type="text"
                value={promptTitle}
              />
              <textarea
                className="textarea"
                id="system-prompt"
                onChange={(event) => setSystemPrompt(event.target.value)}
                value={systemPrompt}
              />
              <input
                className="input"
                id="prompt-tags"
                onChange={(event) => setPromptTagsText(event.target.value)}
                placeholder="Tags, comma separated"
                type="text"
                value={promptTagsText}
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
            <div className="settings-actions">
              <button className="quiet-button" disabled={isSavingSettings} onClick={() => void saveSettings()} type="button">
                {isSavingSettings ? "Saving..." : "Save global settings"}
              </button>
              {evaluatorKeyConfigured ? (
                <button className="quiet-button" disabled={isSavingSettings} onClick={() => void saveSettings(true)} type="button">
                  Clear saved key
                </button>
              ) : null}
            </div>
            {evaluatorKeyConfigured ? <p className="saved-secret">A saved evaluator key is available and never shown here.</p> : null}
          </section>

          <section className="control-section">
              <div className="result-card-top">
              <p className="section-label">Conversation</p>
              <div className="conversation-actions">
                <select
                  aria-label="Load test suite"
                  className="compact-select"
                  onChange={(event) => {
                    setSelectedSuiteId(event.target.value);
                    loadSuite(event.target.value);
                  }}
                  value={selectedSuiteId}
                >
                  <option value="">Load suite</option>
                  {suiteTemplates.map((suite) => (
                    <option key={suite.id} value={suite.id}>
                      {suite.name}
                    </option>
                  ))}
                </select>
                <button className="quiet-button" onClick={saveSuiteTemplate} type="button">
                  Save suite
                </button>
                {selectedSuiteId ? (
                  <>
                    <button className="quiet-button" onClick={updateSuiteTemplate} type="button">
                      Update
                    </button>
                    <button className="quiet-button" onClick={deleteSuiteTemplate} type="button">
                      Delete
                    </button>
                  </>
                ) : null}
                <button className="quiet-button" onClick={addMessage} type="button">
                  + Add turn
                </button>
              </div>
              <input
                className="input"
                id="suite-description"
                onChange={(event) => setSuiteDescription(event.target.value)}
                placeholder="Suite description"
                type="text"
                value={suiteDescription}
              />
              <input
                className="input"
                id="suite-tags"
                onChange={(event) => setSuiteTagsText(event.target.value)}
                placeholder="Suite tags, comma separated"
                type="text"
                value={suiteTagsText}
              />
            </div>
            {messages.map((message, index) => (
              <div className="field" key={`message-${index}`}>
                <label htmlFor={`message-${index}`}>User turn {index + 1}</label>
                <textarea
                  className="textarea"
                  id={`message-${index}`}
                  onChange={(event) => updateMessage(index, event.target.value)}
                  value={message}
                />
                {messages.length > 1 ? (
                  <button className="quiet-button" onClick={() => removeMessage(index)} type="button">
                    Remove turn
                  </button>
                ) : null}
              </div>
            ))}
          </section>

          <section className="control-section">
            <p className="section-label">Local models</p>
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

          {notice ? <div className="notice">{notice}</div> : null}
          <button className="primary-button" disabled={selectedModels.length === 0 || isStarting} onClick={startBenchmark} type="button">
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
                <button className="quiet-button" disabled={["COMPLETED", "FAILED", "CANCELLED"].includes(activeRun.status)} onClick={togglePause} type="button">
                  {activeRun.paused ? "Resume run" : "Pause run"}
                </button>
                <button className="quiet-button" disabled={["COMPLETED", "FAILED", "CANCELLED"].includes(activeRun.status)} onClick={cancelBenchmark} type="button">
                  {activeRun.status === "CANCELLED" ? "Cancelled" : "Cancel run"}
                </button>
              </div>
            ) : (
              <span className="run-count">No active run</span>
            )}
          </div>
          {activeRun ? (
            <div className="results-grid">
              {activeRun.results.map((result) => (
                <ResultCard key={result.id} onReview={updateReview} result={result} />
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
                  Discover your local models, select a test subject, and the dashboard will reveal response quality beside
                  TTFT, throughput, and evaluator notes.
                </p>
              </div>
            </div>
          )}
          {history.length > 0 ? (
            <section className="history-panel" aria-label="Benchmark history">
              <div className="content-topline">
                <div>
                  <p className="section-label">Archive</p>
                  <h2>Previous benchmark runs <span className="history-total">{historyTotal}</span></h2>
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
                  .filter((run) => matchesHistory(run, { keyword: historyFilter, date: historyDate, model: historyModel, score: historyScore }))
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
    </main>
  );
}

function ResultCard({ result, onReview }: { result: ModelResult; onReview: (result: ModelResult, status: HumanStatus) => void }) {
  const [notes, setNotes] = useState(result.humanNotes);
  const statusClass = result.status.toLowerCase();
  const score = result.evaluation?.scoreStars ?? 0;
  return (
    <article className="result-card">
      <div className="result-card-top">
        <div>
          <p className="card-kicker">Local model</p>
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

function parseTags(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);
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
