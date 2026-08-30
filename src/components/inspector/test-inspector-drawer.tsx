"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvaluatorEntry, EvaluationHistoryEntry, ModelResult, TestRun } from "@/lib/contracts";

interface TestInspectorDrawerProps {
  run: TestRun | null;
  result: ModelResult | null;
  onClose: () => void;
}

export function TestInspectorDrawer({ run, result, onClose }: TestInspectorDrawerProps) {
  const [activeTab, setActiveTab] = useState<"prompts" | "evaluator">("prompts");
  const [evaluators, setEvaluators] = useState<EvaluatorEntry[]>([]);
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState<string>("");
  const [reEvaluating, setReEvaluating] = useState(false);
  const [history, setHistory] = useState<EvaluationHistoryEntry[]>([]);
  const [historyResultId, setHistoryResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localResult, setLocalResult] = useState<ModelResult | null>(null);

  const resultId = result?.id ?? null;
  const runId = run?.id ?? null;

  useEffect(() => {
    if (!resultId || !runId) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { settings?: { evaluators?: EvaluatorEntry[]; activeEvaluatorId?: string | null } } | null) => {
        if (cancelled) return;
        const entries = payload?.settings?.evaluators ?? [];
        setEvaluators(entries);
        setSelectedEvaluatorId(payload?.settings?.activeEvaluatorId ?? "");
      })
      .catch(() => {});
    fetch(`/api/runs/${runId}/results/${resultId}?includeHistory=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { evaluationHistory?: EvaluationHistoryEntry[] } | null) => {
        if (cancelled) return;
        setHistory(payload?.evaluationHistory ?? []);
        setHistoryResultId(resultId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resultId, runId]);

  const handleReevaluate = useCallback(async () => {
    if (!resultId || !runId || reEvaluating) return;
    setReEvaluating(true);
    setError(null);
    try {
      const res = await fetch(`/api/results/${resultId}/reevaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evaluatorId: selectedEvaluatorId || undefined }),
      });
      const payload = (await res.json()) as { run?: TestRun; error?: string };
      if (!res.ok || !payload.run) throw new Error(payload.error ?? "Re-evaluation failed.");
      const updated = payload.run.results.find((item) => item.id === resultId) ?? null;
      if (updated) setLocalResult(updated);
      const historyRes = await fetch(`/api/runs/${runId}/results/${resultId}?includeHistory=true`);
      if (historyRes.ok) {
        const historyPayload = (await historyRes.json()) as { evaluationHistory?: EvaluationHistoryEntry[] };
        setHistory(historyPayload.evaluationHistory ?? []);
        setHistoryResultId(resultId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-evaluation failed.");
    } finally {
      setReEvaluating(false);
    }
  }, [resultId, runId, selectedEvaluatorId, reEvaluating]);

  if (!result) return null;

  const displayResult = localResult?.id === result.id ? localResult : result;
  const displayHistory = historyResultId === result.id ? history : [];
  const testName = run?.attackType ?? run?.category ?? "Model Benchmark";
  const systemPrompt = run?.systemPrompt ?? "N/A";
  const userPrompt = run?.userMessages?.join("\n\n---\n\n") ?? "N/A";
  const slmResponse = displayResult.responseText ?? "(No response generated)";

  const stars = displayResult.evaluation?.scoreStars ?? null;
  const renderStars = (rating: number | null) => {
    if (rating === null) return "N/A";
    const rounded = Math.round(rating);
    return "★".repeat(rounded) + "☆".repeat(5 - rounded) + ` (${rating}/5 Stars)`;
  };

  const securityStatus = () => {
    if (displayResult.evaluation?.injectionSuccessful) return <span className="badge danger">🔴 LEAK / INJECTION SUCCESS</span>;
    if (displayResult.evaluation?.systemLeakageDetected || displayResult.evaluation?.visiblePromptLeak) return <span className="badge danger">🔴 SYSTEM LEAK</span>;
    if (displayResult.evaluation?.reasoningPromptLeak) return <span className="badge warn">⚠️ REASONING LEAK ONLY</span>;
    if (run?.category === "SECURITY") return <span className="badge safe">🟢 IMMUNE</span>;
    return <span className="badge safe">🟢 PASS</span>;
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* DRAWER HEADER */}
        <div className="drawer-header">
          <div className="drawer-title-group">
            <span className="drawer-icon">🔍</span>
            <div>
              <h3>Test Inspector</h3>
              <p className="drawer-subtitle">
                Model: <strong>{displayResult.modelName}</strong> &bull; Test: {testName}
              </p>
            </div>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* DRAWER NAVIGATION TABS */}
        <div className="drawer-tabs">
          <button
            type="button"
            className={`drawer-tab ${activeTab === "prompts" ? "active" : ""}`}
            onClick={() => setActiveTab("prompts")}
          >
            💬 Prompts &amp; Response
          </button>
          <button
            type="button"
            className={`drawer-tab ${activeTab === "evaluator" ? "active" : ""}`}
            onClick={() => setActiveTab("evaluator")}
          >
            ⚖️ Evaluator Verdict
          </button>
        </div>

        {/* DRAWER CONTENT */}
        <div className="drawer-body">
          {activeTab === "prompts" ? (
            <div className="drawer-section-group">
              <div className="drawer-box">
                <span className="box-label">SYSTEM PROMPT</span>
                <pre className="code-block">{systemPrompt}</pre>
              </div>

              {displayResult.turns && displayResult.turns.length > 1 ? (
                <div className="drawer-box">
                  <span className="box-label">CONVERSATION TRANSCRIPT</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                    {displayResult.turns.map((t, i) => (
                      <div key={t.id || i} style={{ padding: "8px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "6px" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
                          Turn {t.stepOrder} — User
                        </div>
                        <div style={{ fontSize: "0.85rem", marginBottom: "6px" }}>{t.userMessage}</div>
                        {t.thinking && (
                          <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic", marginBottom: "4px" }}>
                            💭 Thinking: {t.thinking.slice(0, 150)}...
                          </div>
                        )}
                        <div style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--accent)", marginBottom: "4px" }}>
                          Turn {t.stepOrder} — Assistant
                        </div>
                        <div style={{ fontSize: "0.85rem" }}>{t.responseText || "(No answer)"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="drawer-box">
                  <span className="box-label">USER PROMPT</span>
                  <pre className="code-block">{userPrompt}</pre>
                </div>
              )}

              <div className="drawer-box highlight">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="box-label">FINAL MODEL RESPONSE</span>
                  {displayResult.evaluation?.reasoningPromptLeak && (
                    <span className="badge warn" style={{ fontSize: "0.7rem", color: "var(--warning)" }}>
                      ⚠️ Reasoning channel exposed protected information
                    </span>
                  )}
                  {displayResult.finishReason === "length" && (
                    <span className="badge warn" style={{ fontSize: "0.7rem", color: "var(--warning)" }}>
                      ⚠️ Truncated (max tokens reached)
                    </span>
                  )}
                </div>
                <pre className="code-block slm-output">{slmResponse}</pre>
              </div>
            </div>
          ) : (
            <div className="drawer-section-group">
              <div className="drawer-box">
                <span className="box-label">EVALUATOR VERDICT</span>
                <div className="verdict-score-row">
                  <span className="star-display">{renderStars(stars)}</span>
                  {securityStatus()}
                </div>
                {displayResult.evaluation?.feedbackText && (
                  <p className="eval-feedback">&ldquo;{displayResult.evaluation.feedbackText}&rdquo;</p>
                )}
              </div>

              {displayResult.evaluation && (
                <div className="drawer-grid-2">
                  <div className="mini-box">
                    <span>Grammar:</span> <strong>{displayResult.evaluation.grammarRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Compliance:</span> <strong>{displayResult.evaluation.complianceRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Accuracy:</span> <strong>{displayResult.evaluation.accuracyRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Security Score:</span> <strong>{displayResult.evaluation.securityScore ?? "N/A"}</strong>
                  </div>
                </div>
              )}

              {displayResult.evaluation?.vulnerabilityAnalysis && (
                <div className="drawer-box danger-box">
                  <span className="box-label">VULNERABILITY ANALYSIS</span>
                  <p className="vuln-text">{displayResult.evaluation.vulnerabilityAnalysis}</p>
                </div>
              )}

              {/* RE-EVALUATION CONTROLS */}
              {evaluators.length > 0 && displayResult.responseText?.trim() && (
                <div className="drawer-box reevaluate-box">
                  <span className="box-label">RE-EVALUATE (NO RE-INFERENCE)</span>
                  <div className="reevaluate-row">
                    <select
                      className="styled-select"
                      value={selectedEvaluatorId}
                      onChange={(e) => setSelectedEvaluatorId(e.target.value)}
                      disabled={reEvaluating}
                    >
                      {evaluators.map((evaluator) => (
                        <option key={evaluator.id} value={evaluator.id}>
                          {evaluator.label} ({evaluator.model})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-reevaluate"
                      onClick={handleReevaluate}
                      disabled={reEvaluating || !selectedEvaluatorId}
                    >
                      {reEvaluating ? "⏳ Re-evaluating..." : "🔄 Re-evaluate"}
                    </button>
                  </div>
                  {error && <p className="reevaluate-error">{error}</p>}
                </div>
              )}

              {/* EVALUATION HISTORY */}
              {displayHistory.length > 0 && (
                <div className="drawer-box history-box">
                  <span className="box-label">EVALUATION HISTORY ({displayHistory.length})</span>
                  <div className="history-list">
                    {displayHistory.map((entry) => (
                      <div key={entry.id} className="history-entry">
                        <div className="history-entry-head">
                          <span className="history-judge">
                            ⚖️ {entry.evaluatorModel}
                            {entry.evaluatorId ? " (catalog)" : ""}
                          </span>
                          <span className="history-date">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="history-score-row">
                          <span>{renderStars(entry.scoreStars)}</span>
                          {entry.securityScore != null && <span>Security: {entry.securityScore}/5</span>}
                          {entry.injectionSuccessful === true && <span className="badge danger">🔴 LEAK</span>}
                          {entry.systemLeakageDetected === true && <span className="badge danger">🔴 LEAK</span>}
                        </div>
                        {entry.feedbackText && (
                          <p className="eval-feedback">&ldquo;{entry.feedbackText}&rdquo;</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TELEMETRY FOOTER */}
          <div className="drawer-telemetry-strip">
            <h4>EXECUTION TELEMETRY</h4>
            <div className="telemetry-grid">
              <div className="telemetry-item">
                <span className="lbl">TTFT:</span>
                <span className="val">{displayResult.ttftMs != null ? `${displayResult.ttftMs} ms` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Speed:</span>
                <span className="val">{displayResult.tokPerSec != null ? `${displayResult.tokPerSec} tok/s` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Out Toks:</span>
                <span className="val">{displayResult.outputTokens != null ? `${displayResult.outputTokens} tok` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Latency:</span>
                <span className="val">{displayResult.totalDurationMs != null ? `${(displayResult.totalDurationMs / 1000).toFixed(1)} s` : "N/A"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
