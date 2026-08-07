"use client";

import { useState } from "react";
import type { ParameterState } from "@/components/wizard/run-wizard";
import { useTheme } from "@/components/theme-provider";
import type { EvaluatorEntry } from "@/lib/contracts";

interface EvaluatorFormState {
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface SettingsPanelProps {
  ollamaUrl: string;
  onOllamaUrlChange: (url: string) => void;
  evaluators: EvaluatorEntry[];
  activeEvaluatorId: string | null;
  onSetActiveEvaluator: (id: string | null) => Promise<void>;
  onAddEvaluator: (input: { label: string; baseUrl: string; model: string; apiKey: string; makeActive: boolean }) => Promise<void>;
  onUpdateEvaluator: (id: string, input: { label?: string; baseUrl?: string; model?: string; apiKey?: string }) => Promise<void>;
  onDeleteEvaluator: (id: string) => Promise<void>;
  parameters: ParameterState;
  onParametersChange: (params: ParameterState) => void;
  onSaveSettings: () => Promise<void>;
  isSaving: boolean;
  notice?: string;
}

const emptyForm: EvaluatorFormState = { label: "", baseUrl: "", model: "", apiKey: "" };

export function SettingsPanel({
  ollamaUrl,
  onOllamaUrlChange,
  evaluators,
  activeEvaluatorId,
  onSetActiveEvaluator,
  onAddEvaluator,
  onUpdateEvaluator,
  onDeleteEvaluator,
  parameters,
  onParametersChange,
  onSaveSettings,
  isSaving,
  notice,
}: SettingsPanelProps) {
  const { theme, setTheme } = useTheme();
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EvaluatorFormState>(emptyForm);
  const [addForm, setAddForm] = useState<EvaluatorFormState>(emptyForm);
  const [makeActiveOnAdd, setMakeActiveOnAdd] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const startEdit = (evaluator: EvaluatorEntry) => {
    setEditingId(evaluator.id);
    setEditForm({ label: evaluator.label, baseUrl: evaluator.baseUrl, model: evaluator.model, apiKey: "" });
  };

  const submitEdit = async () => {
    if (!editingId) return;
    setFormError(undefined);
    try {
      await onUpdateEvaluator(editingId, {
        label: editForm.label.trim() || undefined,
        baseUrl: editForm.baseUrl.trim(),
        model: editForm.model.trim(),
        apiKey: editForm.apiKey.trim() || undefined,
      });
      setEditingId(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not update evaluator.");
    }
  };

  const submitAdd = async () => {
    setFormError(undefined);
    try {
      await onAddEvaluator({
        label: addForm.label.trim(),
        baseUrl: addForm.baseUrl.trim(),
        model: addForm.model.trim(),
        apiKey: addForm.apiKey.trim(),
        makeActive: makeActiveOnAdd,
      });
      setAddForm(emptyForm);
      setMakeActiveOnAdd(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not add evaluator.");
    }
  };

  const submitDelete = async (id: string, label: string) => {
    if (!window.confirm(`Delete evaluator "${label}"?`)) return;
    setFormError(undefined);
    try {
      await onDeleteEvaluator(id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not delete evaluator.");
    }
  };

  return (
    <form className="settings-panel-form" onSubmit={handleSave}>
      <div className="settings-header">
        <h3>⚙️ System Configuration &amp; Integrations</h3>
        <p>Adjust local Ollama connection URLs, the LLM Judge evaluator catalog, and default parameters.</p>
      </div>

      {notice && <div className="notice-banner">{notice}</div>}
      {savedSuccess && <div className="success-banner">✅ Settings saved successfully.</div>}
      {formError && <div className="error-banner">{formError}</div>}

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
        <h4>2. LLM Judge Evaluators (OpenAI-Compatible)</h4>
        <p className="field-help">
          Register multiple evaluator models; exactly one marked as active is used during evaluations.
        </p>

        {evaluators.length === 0 && (
          <p className="field-help">No evaluators configured yet. Add one below.</p>
        )}

        <div className="evaluator-catalog">
          {evaluators.map((evaluator) => {
            const isActive = evaluator.id === activeEvaluatorId;
            const isEditing = editingId === evaluator.id;
            return (
              <div key={evaluator.id} className={`evaluator-card ${isActive ? "active" : ""}`}>
                <label className="evaluator-radio">
                  <input
                    type="radio"
                    name="active-evaluator"
                    checked={isActive}
                    onChange={() => void onSetActiveEvaluator(evaluator.id)}
                  />
                  <span>Use in evaluations</span>
                </label>

                {isEditing ? (
                  <div className="evaluator-edit-form">
                    <div className="inputs-grid-2">
                      <div className="input-group">
                        <label>Label:</label>
                        <input
                          type="text"
                          value={editForm.label}
                          onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                          placeholder="GPT-4o mini judge"
                        />
                      </div>
                      <div className="input-group">
                        <label>Model:</label>
                        <input
                          type="text"
                          value={editForm.model}
                          onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                          placeholder="gpt-4o-mini"
                        />
                      </div>
                    </div>
                    <div className="input-group">
                      <label>Base URL:</label>
                      <input
                        type="url"
                        value={editForm.baseUrl}
                        onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>
                    <div className="input-group">
                      <label>API Key:</label>
                      <input
                        type="password"
                        value={editForm.apiKey}
                        onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                        placeholder={evaluator.apiKeyConfigured ? "•••••••••••••••• (Configured)" : "sk-..."}
                      />
                    </div>
                    <div className="evaluator-actions">
                      <button type="button" className="btn-secondary" onClick={() => void submitEdit()}>
                        Save
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="evaluator-summary">
                      <span className="evaluator-label">{evaluator.label}</span>
                      <span className="evaluator-model">{evaluator.model}</span>
                      <span className="evaluator-url">{evaluator.baseUrl}</span>
                      <span className={`key-badge ${evaluator.apiKeyConfigured ? "configured" : ""}`}>
                        {evaluator.apiKeyConfigured ? "✓ API key configured" : "No API key"}
                      </span>
                    </div>
                    <div className="evaluator-actions">
                      <button type="button" className="btn-ghost-sm" onClick={() => startEdit(evaluator)}>
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost-sm danger"
                        onClick={() => void submitDelete(evaluator.id, evaluator.label)}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="evaluator-add-form">
          <h5>Add Evaluator</h5>
          <div className="inputs-grid-2">
            <div className="input-group">
              <label>Label (optional):</label>
              <input
                type="text"
                value={addForm.label}
                onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
                placeholder="GPT-4o mini judge"
              />
            </div>
            <div className="input-group">
              <label>Model:</label>
              <input
                type="text"
                value={addForm.model}
                onChange={(e) => setAddForm({ ...addForm, model: e.target.value })}
                placeholder="gpt-4o-mini, openrouter/auto..."
              />
            </div>
          </div>
          <div className="input-group">
            <label>Base URL:</label>
            <input
              type="url"
              value={addForm.baseUrl}
              onChange={(e) => setAddForm({ ...addForm, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="input-group">
            <label>API Key:</label>
            <input
              type="password"
              value={addForm.apiKey}
              onChange={(e) => setAddForm({ ...addForm, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <label className="evaluator-radio">
            <input type="checkbox" checked={makeActiveOnAdd} onChange={(e) => setMakeActiveOnAdd(e.target.checked)} />
            <span>Set as active evaluator</span>
          </label>
          <div className="evaluator-actions">
            <button type="button" className="btn-secondary" onClick={() => void submitAdd()}>
              ＋ Add Evaluator
            </button>
          </div>
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
