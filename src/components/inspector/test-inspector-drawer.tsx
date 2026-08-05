"use client";

import { useState } from "react";
import type { ModelResult, TestRun } from "@/lib/contracts";

interface TestInspectorDrawerProps {
  run: TestRun | null;
  result: ModelResult | null;
  onClose: () => void;
}

export function TestInspectorDrawer({ run, result, onClose }: TestInspectorDrawerProps) {
  const [activeTab, setActiveTab] = useState<"prompts" | "evaluator">("prompts");

  if (!result) return null;

  const testName = run?.attackType ?? run?.category ?? "Model Benchmark";
  const systemPrompt = run?.systemPrompt ?? "N/A";
  const userPrompt = run?.userMessages?.join("\n\n---\n\n") ?? "N/A";
  const slmResponse = result.responseText ?? "(No response generated)";

  const stars = result.evaluation?.scoreStars ?? null;
  const renderStars = (rating: number | null) => {
    if (rating === null) return "N/A";
    const rounded = Math.round(rating);
    return "★".repeat(rounded) + "☆".repeat(5 - rounded) + ` (${rating}/5 Stars)`;
  };

  const securityStatus = () => {
    if (result.evaluation?.injectionSuccessful) return <span className="badge danger">🔴 LEAK / INJECTION SUCCESS</span>;
    if (result.evaluation?.systemLeakageDetected) return <span className="badge danger">🔴 SYSTEM LEAK</span>;
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
                Model: <strong>{result.modelName}</strong> &bull; Test: {testName}
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

              <div className="drawer-box">
                <span className="box-label">USER PROMPT</span>
                <pre className="code-block">{userPrompt}</pre>
              </div>

              <div className="drawer-box highlight">
                <span className="box-label">SLM RESPONSE</span>
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
                {result.evaluation?.feedbackText && (
                  <p className="eval-feedback">&ldquo;{result.evaluation.feedbackText}&rdquo;</p>
                )}
              </div>

              {result.evaluation && (
                <div className="drawer-grid-2">
                  <div className="mini-box">
                    <span>Grammar:</span> <strong>{result.evaluation.grammarRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Compliance:</span> <strong>{result.evaluation.complianceRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Accuracy:</span> <strong>{result.evaluation.accuracyRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Security Score:</span> <strong>{result.evaluation.securityScore ?? "N/A"}</strong>
                  </div>
                </div>
              )}

              {result.evaluation?.vulnerabilityAnalysis && (
                <div className="drawer-box danger-box">
                  <span className="box-label">VULNERABILITY ANALYSIS</span>
                  <p className="vuln-text">{result.evaluation.vulnerabilityAnalysis}</p>
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
                <span className="val">{result.ttftMs != null ? `${result.ttftMs} ms` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Speed:</span>
                <span className="val">{result.tokPerSec != null ? `${result.tokPerSec} tok/s` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Out Toks:</span>
                <span className="val">{result.outputTokens != null ? `${result.outputTokens} tok` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Latency:</span>
                <span className="val">{result.totalDurationMs != null ? `${(result.totalDurationMs / 1000).toFixed(1)} s` : "N/A"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}