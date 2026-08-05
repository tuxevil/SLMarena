"use client";

import { useState } from "react";
import type { ParameterState } from "@/components/wizard/run-wizard";
import { useTheme } from "@/components/theme-provider";

interface SettingsPanelProps {
  ollamaUrl: string;
  onOllamaUrlChange: (url: string) => void;
  evaluatorBaseUrl: string;
  onEvaluatorBaseUrlChange: (url: string) => void;
  evaluatorModel: string;
  onEvaluatorModelChange: (model: string) => void;
  evaluatorApiKey: string;
  onEvaluatorApiKeyChange: (key: string) => void;
  evaluatorKeyConfigured: boolean;
  parameters: ParameterState;
  onParametersChange: (params: ParameterState) => void;
  onSaveSettings: () => Promise<void>;
  isSaving: boolean;
  notice?: string;
}

export function SettingsPanel({
  ollamaUrl,
  onOllamaUrlChange,
  evaluatorBaseUrl,
  onEvaluatorBaseUrlChange,
  evaluatorModel,
  onEvaluatorModelChange,
  evaluatorApiKey,
  onEvaluatorApiKeyChange,
  evaluatorKeyConfigured,
  parameters,
  onParametersChange,
  onSaveSettings,
  isSaving,
  notice,
}: SettingsPanelProps) {
  const { theme, setTheme } = useTheme();
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <form className="settings-panel-form" onSubmit={handleSave}>
      <div className="settings-header">
        <h3>⚙️ System Configuration &amp; Integrations</h3>
        <p>Adjust local Ollama connection URLs, the LLM Judge evaluator, and default parameters.</p>
      </div>

      {notice && <div className="notice-banner">{notice}</div>}
      {savedSuccess && <div className="success-banner">✅ Settings saved successfully.</div>}

      <div className="settings-section">
        <h4>1. Local Ollama Connection</h4>
        <div className="input-group">
          <label>Ollama Server URL:</label>
          <input
            type="url"
            value={ollamaUrl}
            onChange={(e) => onOllamaUrlChange(e.target.value)}
            placeholder="http://localhost:11434"
            required
          />
          <span className="field-help">Local server hosting SLM models.</span>
        </div>
      </div>

      <div className="settings-section">
        <h4>2. LLM Judge Evaluator (OpenAI-Compatible)</h4>
        <div className="inputs-grid-2">
          <div className="input-group">
            <label>Evaluator Base URL:</label>
            <input
              type="url"
              value={evaluatorBaseUrl}
              onChange={(e) => onEvaluatorBaseUrlChange(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div className="input-group">
            <label>Evaluator / Judge Model:</label>
            <input
              type="text"
              value={evaluatorModel}
              onChange={(e) => onEvaluatorModelChange(e.target.value)}
              placeholder="gpt-4o-mini, openrouter/auto..."
            />
          </div>
        </div>

        <div className="input-group">
          <label>Evaluator API Key:</label>
          <input
            type="password"
            value={evaluatorApiKey}
            onChange={(e) => onEvaluatorApiKeyChange(e.target.value)}
            placeholder={evaluatorKeyConfigured ? "•••••••••••••••• (Configured)" : "sk-..."}
          />
          <span className="field-help">
            {evaluatorKeyConfigured
              ? "✓ An API Key is already securely configured. Enter a new value only if you wish to change it."
              : "Enter your OpenAI or compatible provider API Key."}
          </span>
        </div>
      </div>

      <div className="settings-section">
        <h4>3. Global Default Parameters for Inference</h4>
        <div className="params-inputs-grid">
          <div className="input-group">
            <label>Temperature:</label>
            <input
              type="number"
              step="0.1"
              value={parameters.temperature}
              onChange={(e) => onParametersChange({ ...parameters, temperature: e.target.value })}
            />
          </div>

          <div className="input-group">
            <label>Context Size (numCtx):</label>
            <input
              type="number"
              step="512"
              value={parameters.numCtx}
              onChange={(e) => onParametersChange({ ...parameters, numCtx: e.target.value })}
            />
          </div>

          <div className="input-group">
            <label>Top P:</label>
            <input
              type="number"
              step="0.05"
              value={parameters.topP}
              onChange={(e) => onParametersChange({ ...parameters, topP: e.target.value })}
            />
          </div>

          <div className="input-group">
            <label>Repeat Penalty:</label>
            <input
              type="number"
              step="0.05"
              value={parameters.repeatPenalty}
              onChange={(e) => onParametersChange({ ...parameters, repeatPenalty: e.target.value })}
            />
          </div>

          <div className="input-group">
            <label>Num Predict (Max Tokens):</label>
            <input
              type="number"
              step="256"
              value={parameters.numPredict}
              onChange={(e) => onParametersChange({ ...parameters, numPredict: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h4>4. Appearance &amp; Application Theme</h4>
        <div className="theme-options-grid">
          <button
            type="button"
            className={`theme-option-card ${theme === "light" ? "selected" : ""}`}
            onClick={() => setTheme("light")}
          >
            <span className="icon">☀️</span>
            <span className="title">Light Mode</span>
            <span className="desc">Clean light background with high contrast</span>
          </button>

          <button
            type="button"
            className={`theme-option-card ${theme === "dark" ? "selected" : ""}`}
            onClick={() => setTheme("dark")}
          >
            <span className="icon">🌙</span>
            <span className="title">Dark Mode</span>
            <span className="desc">Dark interface optimized for low light</span>
          </button>

          <button
            type="button"
            className={`theme-option-card ${theme === "system" ? "selected" : ""}`}
            onClick={() => setTheme("system")}
          >
            <span className="icon">💻</span>
            <span className="title">System Theme</span>
            <span className="desc">Automatically matches your OS preference</span>
          </button>
        </div>
      </div>

      <div className="settings-actions">
        <button type="submit" className="btn-primary" disabled={isSaving}>
          {isSaving ? "Saving..." : "💾 Save Settings"}
        </button>
      </div>
    </form>
  );
}
