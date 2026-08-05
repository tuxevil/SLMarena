"use client";

import { useState } from "react";
import type { Scenario, SecurityAttackType, TestCategory } from "@/lib/contracts";
import { SECURITY_TEMPLATES } from "@/lib/security-templates";

export type ModelOption = {
  name: string;
  size: string;
};

export type ParameterState = {
  temperature: string;
  numCtx: string;
  topP: string;
  repeatPenalty: string;
  numPredict: string;
};

interface RunWizardProps {
  ollamaUrl: string;
  models: ModelOption[];
  onDiscoverModels: () => Promise<void>;
  isDiscovering: boolean;
  onStartRun: (params: {
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    messages: string[];
    selectedModels: string[];
    samplesPerModel: number;
    parameters: ParameterState;
  }) => Promise<void>;
  isStarting: boolean;
  // Scenario Library Management
  scenarios: Scenario[];
  selectedScenarioId: string;
  onScenarioChange: (scenarioId: string) => void;
  scenarioName: string;
  onScenarioNameChange: (name: string) => void;
  onSaveScenario: (data: {
    name: string;
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    userMessages: string[];
  }) => Promise<void>;
  onDeleteScenario: () => Promise<void>;
  onDuplicateScenario: () => void;
}

export function RunWizard({
  ollamaUrl,
  models,
  onDiscoverModels,
  isDiscovering,
  onStartRun,
  isStarting,
  scenarios,
  selectedScenarioId,
  onScenarioChange,
  scenarioName,
  onScenarioNameChange,
  onSaveScenario,
  onDeleteScenario,
  onDuplicateScenario,
}: RunWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Preset & Prompt
  const [testType, setTestType] = useState<"general" | "security">("general");
  const [attackType, setAttackType] = useState<SecurityAttackType>("INSTRUCTION_OVERRIDE");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a precise technical assistant. Explain trade-offs clearly and do not invent facts."
  );
  const [userMessages, setUserMessages] = useState<string[]>([
    "Compare REST and GraphQL for a small internal service.",
  ]);

  // Step 2: Models
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [samplesPerModel, setSamplesPerModel] = useState<string>("1");

  // Step 3: Parameters
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [parameters, setParameters] = useState<ParameterState>({
    temperature: "0.2",
    numCtx: "8192",
    topP: "0.9",
    repeatPenalty: "1.1",
    numPredict: "4096",
  });

  // Handle Scenario Selection with full state population
  const handleSelectScenario = (id: string) => {
    onScenarioChange(id);
    if (!id) {
      onScenarioNameChange("New Scenario");
      setTestType("general");
      setAttackType("INSTRUCTION_OVERRIDE");
      setSystemPrompt("You are a precise technical assistant. Explain trade-offs clearly and do not invent facts.");
      setUserMessages(["Compare REST and GraphQL for a small internal service."]);
      return;
    }

    const scenario = scenarios.find((s) => s.id === id);
    if (scenario) {
      onScenarioNameChange(scenario.name);
      setTestType(scenario.category === "SECURITY" ? "security" : "general");
      if (scenario.attackType) setAttackType(scenario.attackType);
      setSystemPrompt(scenario.systemPrompt || "");
      setUserMessages(scenario.userMessages && scenario.userMessages.length > 0 ? scenario.userMessages : [""]);
    }
  };

  // Apply Security Preset
  const applyPreset = (preset: "general" | "security", selectedAttack: SecurityAttackType = attackType) => {
    setTestType(preset);
    if (preset === "security") {
      const template = SECURITY_TEMPLATES[selectedAttack];
      setSystemPrompt(template.systemPrompt);
      setUserMessages(template.userMessages);
    } else {
      setSystemPrompt("You are a precise technical assistant. Explain trade-offs clearly and do not invent facts.");
      setUserMessages(["Compare REST and GraphQL for a small internal service."]);
    }
  };

  const addTurn = () => {
    setUserMessages((prev) => [...prev, ""]);
  };

  const updateTurn = (index: number, content: string) => {
    setUserMessages((prev) => prev.map((msg, i) => (i === index ? content : msg)));
  };

  const removeTurn = (index: number) => {
    if (userMessages.length <= 1) return;
    setUserMessages((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleSelectAllModels = () => {
    if (selectedModels.length === models.length) {
      setSelectedModels([]);
    } else {
      setSelectedModels(models.map((m) => m.name));
    }
  };

  const toggleModel = (name: string) => {
    setSelectedModels((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]
    );
  };

  const handleSaveCurrentScenario = async () => {
    await onSaveScenario({
      name: scenarioName,
      category: testType === "security" ? "SECURITY" : "GENERAL",
      attackType: testType === "security" ? attackType : null,
      systemPrompt,
      userMessages,
    });
  };

  const handleLaunch = async () => {
    if (selectedModels.length === 0) return;
    await onStartRun({
      category: testType === "security" ? "SECURITY" : "GENERAL",
      attackType: testType === "security" ? attackType : null,
      systemPrompt,
      messages: userMessages,
      selectedModels,
      samplesPerModel: Number(samplesPerModel) || 1,
      parameters,
    });
  };

  return (
    <div className="wizard-container">
      {/* Wizard Header Progress Bar */}
      <div className="wizard-progress-bar">
        <div className={`step-pill ${step >= 1 ? "active" : ""}`} onClick={() => setStep(1)}>
          <span className="step-num">1</span>
          <span className="step-title">Scenario &amp; Turns ({userMessages.length})</span>
        </div>
        <div className="step-connector" />
        <div className={`step-pill ${step >= 2 ? "active" : ""}`} onClick={() => setStep(2)}>
          <span className="step-num">2</span>
          <span className="step-title">SLM Models ({selectedModels.length})</span>
        </div>
        <div className="step-connector" />
        <div className={`step-pill ${step >= 3 ? "active" : ""}`} onClick={() => setStep(3)}>
          <span className="step-num">3</span>
          <span className="step-title">Launch Benchmark</span>
        </div>
      </div>

      {/* Step 1: Scenario Library & Prompts */}
      {step === 1 && (
        <div className="wizard-step-panel">
          <div className="panel-header">
            <h3>Step 1: Configure Scenario &amp; Conversation Turns</h3>
            <p>Load saved scenarios from the library or write new multi-turn tests.</p>
          </div>

          {/* Scenario Library Toolbar */}
          <div className="scenario-library-box">
            <div className="scenario-select-row">
              <div className="input-group flex-1">
                <label>Saved Scenarios Library:</label>
                <select
                  value={selectedScenarioId}
                  onChange={(e) => handleSelectScenario(e.target.value)}
                  className="styled-text-input"
                >
                  <option value="">+ Create New Draft Scenario</option>
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.category})
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group flex-1">
                <label>Scenario Name:</label>
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => onScenarioNameChange(e.target.value)}
                  placeholder="Your scenario name..."
                  className="styled-text-input"
                />
              </div>
            </div>

            <div className="scenario-actions-row">
              <button type="button" className="btn-secondary" onClick={handleSaveCurrentScenario}>
                💾 Save to Library
              </button>
              <button type="button" className="btn-ghost" onClick={onDuplicateScenario}>
                📋 Copy to Draft
              </button>
              {selectedScenarioId && (
                <button type="button" className="btn-ghost danger" onClick={onDeleteScenario}>
                  🗑️ Delete Scenario
                </button>
              )}
            </div>
          </div>

          {/* Preset Selector Grid */}
          <div className="preset-selector-grid">
            <div
              className={`preset-card ${testType === "general" ? "selected" : ""}`}
              onClick={() => applyPreset("general")}
            >
              <div className="preset-icon">🧠</div>
              <div className="preset-info">
                <h4>General Quality Test</h4>
                <p>Evaluate accuracy, technical reasoning, and standard generation speed.</p>
              </div>
            </div>

            <div
              className={`preset-card ${testType === "security" ? "selected" : ""}`}
              onClick={() => applyPreset("security")}
            >
              <div className="preset-icon">🛡️</div>
              <div className="preset-info">
                <h4>Stress Test / Security (Red-Teaming)</h4>
                <p>Attempt to exploit model vulnerabilities via ASR attacks (Leakage, Injection, Override).</p>
              </div>
            </div>
          </div>

          {testType === "security" && (
            <div className="attack-type-picker">
              <label>Adversarial Attack Type (ASR):</label>
              <div className="attack-options">
                {(Object.keys(SECURITY_TEMPLATES) as SecurityAttackType[]).map((type) => {
                  const tmpl = SECURITY_TEMPLATES[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`attack-btn ${attackType === type ? "active" : ""}`}
                      onClick={() => {
                        setAttackType(type);
                        applyPreset("security", type);
                      }}
                    >
                      <span>{tmpl.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="attack-description">{SECURITY_TEMPLATES[attackType].description}</p>
            </div>
          )}

          {/* System Prompt & Multi-turn User Messages */}
          <div className="prompt-inputs-section">
            <div className="input-group">
              <label>System Prompt:</label>
              <textarea
                rows={3}
                className="styled-textarea"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="System prompt for model..."
              />
            </div>

            <div className="turns-builder-container">
              <div className="turns-header">
                <label>User Message Turns ({userMessages.length}):</label>
                <button type="button" className="btn-ghost-sm" onClick={addTurn}>
                  + Add Conversation Turn
                </button>
              </div>

              {userMessages.map((msg, index) => (
                <div key={index} className="turn-input-row">
                  <span className="turn-badge">Turn {index + 1}</span>
                  <textarea
                    rows={2}
                    className="styled-textarea flex-1"
                    value={msg}
                    onChange={(e) => updateTurn(index, e.target.value)}
                    placeholder={`User message for turn ${index + 1}...`}
                  />
                  {userMessages.length > 1 && (
                    <button
                      type="button"
                      className="btn-ghost-sm danger"
                      onClick={() => removeTurn(index)}
                      title="Delete this turn"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="wizard-actions">
            <button type="button" className="btn-primary" onClick={() => setStep(2)}>
              Next: Select Models ➔
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Model Selection */}
      {step === 2 && (
        <div className="wizard-step-panel">
          <div className="panel-header-row">
            <div>
              <h3>Step 2: Select SLM Models to Evaluate</h3>
              <p>Ollama at <code className="mono">{ollamaUrl}</code></p>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onDiscoverModels}
                disabled={isDiscovering}
              >
                {isDiscovering ? "Discovering..." : "🔄 Scan Local Ollama"}
              </button>
              {models.length > 0 && (
                <button type="button" className="btn-ghost" onClick={toggleSelectAllModels}>
                  {selectedModels.length === models.length ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
          </div>

          {models.length === 0 ? (
            <div className="wizard-empty-models">
              <p>No local models found in Ollama.</p>
              <button type="button" className="btn-primary" onClick={onDiscoverModels} disabled={isDiscovering}>
                Scan Models
              </button>
            </div>
          ) : (
            <div className="models-checkbox-grid">
              {models.map((m) => {
                const isSelected = selectedModels.includes(m.name);
                return (
                  <div
                    key={m.name}
                    className={`model-checkbox-card ${isSelected ? "selected" : ""}`}
                    onClick={() => toggleModel(m.name)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleModel(m.name)}
                    />
                    <div className="model-details">
                      <span className="model-name">{m.name}</span>
                      <span className="model-size">{m.size}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="samples-row">
            <label>Samples per model (Iterations):</label>
            <input
              type="number"
              min={1}
              max={10}
              className="styled-text-input"
              value={samplesPerModel}
              onChange={(e) => setSamplesPerModel(e.target.value)}
              style={{ width: "90px" }}
            />
          </div>

          <div className="wizard-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              ⬅️ Back
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={selectedModels.length === 0}
              onClick={() => setStep(3)}
            >
              Next: Configure &amp; Launch ➔
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Parameters & Launch */}
      {step === 3 && (
        <div className="wizard-step-panel">
          <div className="panel-header">
            <h3>Step 3: Confirmation &amp; Benchmark Launch</h3>
            <p>Will run {selectedModels.length} model(s) with {samplesPerModel} sample(s) each.</p>
          </div>

          <div className="launch-summary-card">
            <div className="summary-row">
              <span className="label">Test Type:</span>
              <span className="value bold">
                {testType === "security" ? `🛡️ Red-Teaming (${SECURITY_TEMPLATES[attackType].name})` : "🧠 General Quality"}
              </span>
            </div>
            <div className="summary-row">
              <span className="label">Selected Models:</span>
              <div className="model-tags">
                {selectedModels.map((m) => (
                  <span key={m} className="tag">{m}</span>
                ))}
              </div>
            </div>
            <div className="summary-row">
              <span className="label">User Turns ({userMessages.length}):</span>
              <div className="messages-preview-list">
                {userMessages.map((msg, i) => (
                  <div key={i} className="msg-preview-item">
                    <span className="idx">T{i + 1}:</span>
                    <span className="mono">{msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Toggle Advanced Params */}
          <div className="advanced-params-toggle">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowAdvancedParams(!showAdvancedParams)}
            >
              {showAdvancedParams ? "▼ Hide Advanced Hyperparameters" : "▶ Show Advanced Hyperparameters (Smart Defaults)"}
            </button>
          </div>

          {showAdvancedParams && (
            <div className="advanced-params-grid">
              <div className="param-field">
                <label>Temperature (0 - 2.0):</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  className="styled-text-input"
                  value={parameters.temperature}
                  onChange={(e) => setParameters({ ...parameters, temperature: e.target.value })}
                />
              </div>

              <div className="param-field">
                <label>Context Size (numCtx):</label>
                <input
                  type="number"
                  step="512"
                  className="styled-text-input"
                  value={parameters.numCtx}
                  onChange={(e) => setParameters({ ...parameters, numCtx: e.target.value })}
                />
              </div>

              <div className="param-field">
                <label>Top P (0 - 1.0):</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  className="styled-text-input"
                  value={parameters.topP}
                  onChange={(e) => setParameters({ ...parameters, topP: e.target.value })}
                />
              </div>

              <div className="param-field">
                <label>Repeat Penalty:</label>
                <input
                  type="number"
                  step="0.05"
                  className="styled-text-input"
                  value={parameters.repeatPenalty}
                  onChange={(e) => setParameters({ ...parameters, repeatPenalty: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="wizard-actions launch">
            <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
              ⬅️ Back
            </button>
            <button
              type="button"
              className="btn-launch-hero"
              disabled={isStarting || selectedModels.length === 0}
              onClick={handleLaunch}
            >
              {isStarting ? "⏳ Starting Benchmark..." : "🚀 Launch Benchmark & Evaluate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
