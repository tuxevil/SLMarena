"use client";

import { useState } from "react";
import type { EvaluatorEntry, HumanStatus, ModelResult, TestRun } from "@/lib/contracts";
import { ModelGroupedResultsList, type ConsolidatedItem } from "@/components/history/model-grouped-results";

interface RunHistoryMatrixProps {
  activeRun: TestRun | null;
  history: TestRun[];
  historyTotal: number;
  filterKeyword: string;
  onFilterKeywordChange: (val: string) => void;
  filterDate: string;
  onFilterDateChange: (val: string) => void;
  filterModel: string;
  onFilterModelChange: (val: string) => void;
  filterVulnerableOnly: boolean;
  onFilterVulnerableOnlyChange: (val: boolean) => void;
  onSelectRunForComparison: (run: TestRun) => void;
  onHumanReview: (resultId: string, status: HumanStatus, notes?: string) => Promise<void>;
  onDeleteResult: (runId: string, resultId: string) => void;
  onPauseRun?: (runId: string) => Promise<void>;
  onResumeRun?: (runId: string) => Promise<void>;
  onCancelRun?: (runId: string) => Promise<void>;
  onReevaluateRun?: (runId: string, evaluatorId: string) => Promise<void>;
}

export function RunHistoryMatrix({
  activeRun,
  history,
  historyTotal,
  filterKeyword,
  onFilterKeywordChange,
  filterDate,
  onFilterDateChange,
  filterModel,
  onFilterModelChange,
  filterVulnerableOnly,
  onFilterVulnerableOnlyChange,
  onSelectRunForComparison,
  onHumanReview,
  onDeleteResult,
  onPauseRun,
  onResumeRun,
  onCancelRun,
  onReevaluateRun,
}: RunHistoryMatrixProps) {
  const [viewMode, setViewMode] = useState<"grouped" | "runs">("grouped");
  const [expandedRunIds, setExpandedRunIds] = useState<string[]>([]);
  const [selectedResultForReview, setSelectedResultForReview] = useState<ModelResult | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reevalTargetRunId, setReevalTargetRunId] = useState<string | null>(null);
  const [reevalEvaluators, setReevalEvaluators] = useState<EvaluatorEntry[]>([]);
  const [reevalSelectedId, setReevalSelectedId] = useState("");
  const [reevalBusy, setReevalBusy] = useState(false);
  const [reevalError, setReevalError] = useState<string | null>(null);

  // Build consolidated items across active run & history for Grouped View
  const consolidatedItems: ConsolidatedItem[] = [];
  const processedIds = new Set<string>();

  if (activeRun) {
    for (const r of activeRun.results) {
      if (!processedIds.has(r.id)) {
        processedIds.add(r.id);
        consolidatedItems.push({
          runId: activeRun.id,
          runLabel: new Date(activeRun.createdAt).toLocaleString(),
          result: r,
        });
      }
    }
  }

  for (const run of history) {
    for (const r of run.results) {
      if (!processedIds.has(r.id)) {
        processedIds.add(r.id);
        consolidatedItems.push({
          runId: run.id,
          runLabel: new Date(run.createdAt).toLocaleString(),
          result: r,
        });
      }
    }
  }

  const toggleExpandRun = (runId: string) => {
    setExpandedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId]
    );
  };

  const expandAll = () => {
    setExpandedRunIds(history.map((r) => r.id));
  };

  const collapseAll = () => {
    setExpandedRunIds([]);
  };

  const handleReviewSubmit = async (status: HumanStatus) => {
    if (!selectedResultForReview) return;
    await onHumanReview(selectedResultForReview.id, status, reviewNotes);
    setSelectedResultForReview(null);
    setReviewNotes("");
  };

  const openReevaluateModal = async (runId: string) => {
    setReevalTargetRunId(runId);
    setReevalError(null);
    setReevalSelectedId("");
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Could not load evaluators.");
      const payload = (await res.json()) as { settings?: { evaluators?: EvaluatorEntry[]; activeEvaluatorId?: string | null } };
      const entries = payload.settings?.evaluators ?? [];
      setReevalEvaluators(entries);
      setReevalSelectedId(payload.settings?.activeEvaluatorId ?? entries[0]?.id ?? "");
    } catch (err) {
      setReevalError(err instanceof Error ? err.message : "Could not load evaluators.");
    }
  };

  const handleReevaluateRun = async () => {
    if (!reevalTargetRunId || !reevalSelectedId || !onReevaluateRun) return;
    setReevalBusy(true);
    setReevalError(null);
    try {
      await onReevaluateRun(reevalTargetRunId, reevalSelectedId);
      setReevalTargetRunId(null);
    } catch (err) {
      setReevalError(err instanceof Error ? err.message : "Re-evaluation failed.");
    } finally {
      setReevalBusy(false);
    }
  };

  return (
    <div className="history-matrix-panel">
      {/* Active Run Live Bar */}
      {activeRun && ["PENDING", "RUNNING"].includes(activeRun.status) && (
        <div className="active-run-hero-banner">
          <div className="banner-info">
            <div className="badge-live">● LIVE</div>
            <div>
              <h4>Run in Progress #{activeRun.id.slice(0, 8)}</h4>
              <p>Models: {activeRun.models.join(", ")} | Category: {activeRun.category}</p>
            </div>
          </div>

          <div className="banner-controls">
            <div className="progress-counter">
              {activeRun.results.filter((r) => r.status === "COMPLETED").length} / {activeRun.results.length} samples
            </div>
            {activeRun.paused ? (
              <button
                type="button"
                className="btn-action resume"
                onClick={() => onResumeRun?.(activeRun.id)}
              >
                ▶️ Resume
              </button>
            ) : (
              <button
                type="button"
                className="btn-action pause"
                onClick={() => onPauseRun?.(activeRun.id)}
              >
                ⏸️ Pause
              </button>
            )}
            <button
              type="button"
              className="btn-action cancel"
              onClick={() => onCancelRun?.(activeRun.id)}
            >
              🛑 Cancel Run
            </button>
          </div>
        </div>
      )}

      {/* Filter & View Switcher Toolbar */}
      <div className="history-filter-bar">
        <div className="view-mode-toggle-group">
          <button
            type="button"
            className={`btn-view-toggle ${viewMode === "grouped" ? "active" : ""}`}
            onClick={() => setViewMode("grouped")}
          >
            📊 Grouped by Model (Detailed)
          </button>
          <button
            type="button"
            className={`btn-view-toggle ${viewMode === "runs" ? "active" : ""}`}
            onClick={() => setViewMode("runs")}
          >
            📑 Run List &amp; Side-by-Side
          </button>
        </div>

        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="styled-text-input"
            placeholder="Search by prompt, ID, or model..."
            value={filterKeyword}
            onChange={(e) => onFilterKeywordChange(e.target.value)}
          />
        </div>

        <div className="filter-controls-group">
          {/* Toggle Failures Filter */}
          <button
            type="button"
            className={`btn-filter-toggle ${filterVulnerableOnly ? "active" : ""}`}
            onClick={() => onFilterVulnerableOnlyChange(!filterVulnerableOnly)}
          >
            ⚠️ {filterVulnerableOnly ? "Showing Failures Only" : "Filter Failures Only"}
          </button>

          <input
            type="date"
            className="styled-date-input"
            value={filterDate}
            onChange={(e) => onFilterDateChange(e.target.value)}
          />

          <input
            type="text"
            className="styled-text-input model-filter"
            placeholder="Filter model..."
            value={filterModel}
            onChange={(e) => onFilterModelChange(e.target.value)}
          />
        </div>
      </div>

      {/* View Mode 1: Detailed Grouped by Model */}
      {viewMode === "grouped" && (
        <ModelGroupedResultsList
          items={consolidatedItems}
          onDeleteResult={onDeleteResult}
          onHumanReview={onHumanReview}
        />
      )}

      {/* View Mode 2: Runs Accordion List */}
      {viewMode === "runs" && (
        <div className="history-runs-accordion-list">
          <div className="list-counter-strip flex-between">
            <span>{historyTotal} Recorded Runs</span>
            <div className="accordion-bulk-actions">
              <button type="button" className="btn-ghost-sm" onClick={expandAll}>
                ▼ Expand All
              </button>
              <button type="button" className="btn-ghost-sm" onClick={collapseAll}>
                ▲ Collapse All
              </button>
            </div>
          </div>

          {history.length === 0 ? (
            <div className="history-empty-state">
              <p>No runs found matching the filters.</p>
            </div>
          ) : (
            history.map((run) => {
              const isExpanded = expandedRunIds.includes(run.id);
              const failedSamples = run.results.filter((r) => {
                const isSecFail =
                  r.evaluation?.injectionSuccessful === true ||
                  r.evaluation?.systemLeakageDetected === true ||
                  (r.evaluation?.securityScore != null && r.evaluation.securityScore < 50);
                const isLowQuality = (r.evaluation?.scoreStars ?? 5) < 3;
                return isSecFail || isLowQuality || r.status === "FAILED" || r.evalStatus === "FAILED";
              });
              const hasFailures = failedSamples.length > 0;

              return (
                <div
                  key={run.id}
                  className={`run-accordion-card ${hasFailures ? "card-has-failures" : ""} ${isExpanded ? "expanded" : ""}`}
                >
                  {/* Accordion Header */}
                  <div className="accordion-header" onClick={() => toggleExpandRun(run.id)}>
                    <div className="header-main-info">
                      <button type="button" className="expand-chevron">
                        {isExpanded ? "▼" : "▶"}
                      </button>
                      <span className="mono-id">#{run.id.slice(0, 8)}</span>
                      <span className="date-sub">
                        {new Date(run.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className={`cat-pill ${run.category}`}>
                        {run.category === "SECURITY" ? `🛡️ ${run.attackType || "SECURITY"}` : "🧠 GENERAL"}
                      </span>
                    </div>

                    <div className="header-prompt-summary" title={run.systemPrompt}>
                      <span className="prompt-label">Prompt:</span>
                      <span className="prompt-preview">{run.systemPrompt}</span>
                    </div>

                    <div className="header-meta-group">
                      <div className="models-badges">
                        {run.models.map((m) => (
                          <span key={m} className="model-chip">
                            {m}
                          </span>
                        ))}
                      </div>

                      {hasFailures ? (
                        <span className="failure-badge high">
                          🚨 {failedSamples.length} Failure(s)
                        </span>
                      ) : (
                        <span className="failure-badge safe">
                          ✅ Clean
                        </span>
                      )}

                      <div className="action-buttons-group" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn-side-by-side"
                          onClick={() => onSelectRunForComparison(run)}
                        >
                          👁️ Side-by-Side
                        </button>
                        {onReevaluateRun && (
                          <button
                            type="button"
                            className="btn-reevaluate"
                            onClick={() => openReevaluateModal(run.id)}
                            title="Re-evaluate all completed samples with another judge (no re-inference)"
                          >
                            ⚖️ Re-evaluate
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Accordion Collapsible Content */}
                  {isExpanded && (
                    <div className="accordion-body">
                      <div className="body-section-title">
                        <span>Evaluated Samples by Model ({run.results.length})</span>
                      </div>

                      <div className="samples-grid">
                        {run.results.map((result) => {
                          const stars = result.evaluation?.scoreStars;
                          const isVulnerable =
                            run.category === "SECURITY" &&
                            (result.evaluation?.injectionSuccessful === true ||
                              result.evaluation?.systemLeakageDetected === true ||
                              (result.evaluation?.securityScore != null && result.evaluation.securityScore < 50));
                          const isLowQuality = stars != null && stars < 3;
                          const isFailed = result.status === "FAILED" || result.evalStatus === "FAILED" || isVulnerable || isLowQuality;

                          return (
                            <div
                              key={result.id}
                              className={`sample-item-card ${isFailed ? "sample-failed" : "sample-passed"}`}
                            >
                              <div className="sample-card-header">
                                <span className="model-name-title">{result.modelName}</span>
                                <span className="sample-index-tag">#{result.sampleIndex + 1}</span>
                                {isVulnerable ? (
                                  <span className="asr-badge high">🚨 Vulnerable</span>
                                ) : isLowQuality ? (
                                  <span className="asr-badge medium">⚠️ Low ({stars}★)</span>
                                ) : result.evalStatus === "FAILED" ? (
                                  <span className="asr-badge high">⚠️ Eval fallida</span>
                                ) : (
                                  <span className="asr-badge low">✅ OK</span>
                                )}
                              </div>

                              <div className="sample-telemetry-row">
                                <span>TTFT: <strong>{result.ttftMs != null ? `${result.ttftMs}ms` : "—"}</strong></span>
                                <span>Speed: <strong className="speed">{result.tokPerSec != null ? `${result.tokPerSec}t/s` : "—"}</strong></span>
                                <span>Quality: <strong className="star">{stars != null ? `${stars}★` : "—"}</strong></span>
                              </div>

                              <div className="sample-response-preview">
                                <pre>{result.responseText || result.errorMessage || "(No response)"}</pre>
                              </div>

                              {result.evaluation?.feedbackText && (
                                <div className="sample-feedback-box">
                                  <span>⚖️ Judge: {result.evaluation.feedbackText}</span>
                                </div>
                              )}

                              {result.evalStatus === "FAILED" && result.errorMessage && (
                                <div className="sample-feedback-box">
                                  <span>⚠️ Evaluación fallida: {result.errorMessage}</span>
                                </div>
                              )}

                              <div className="sample-human-review-strip">
                                <span>Review: <strong>{result.humanStatus}</strong></span>
                                <div className="review-btn-row">
                                  <button
                                    type="button"
                                    className="btn-review-mini approve"
                                    onClick={() => onHumanReview(result.id, "APPROVED")}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-review-mini reject"
                                    onClick={() => onHumanReview(result.id, "REJECTED")}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Human Review Modal if selected */}
      {selectedResultForReview && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Human Review of Result</h3>
            <p>Model: <strong>{selectedResultForReview.modelName}</strong></p>
            <textarea
              className="styled-textarea"
              placeholder="Optional human review notes..."
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-action approve"
                onClick={() => handleReviewSubmit("APPROVED")}
              >
                ✅ Approve Model
              </button>
              <button
                type="button"
                className="btn-action reject"
                onClick={() => handleReviewSubmit("REJECTED")}
              >
                ❌ Reject Model
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSelectedResultForReview(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-evaluate Run Modal */}
      {reevalTargetRunId && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>⚖️ Re-evaluate Run</h3>
            <p>
              Run <strong>#{reevalTargetRunId.slice(0, 8)}</strong>: re-evaluates all completed
              samples with another judge. Stored responses are reused (no re-inference).
            </p>
            {reevalEvaluators.length > 0 ? (
              <select
                className="styled-select"
                value={reevalSelectedId}
                onChange={(e) => setReevalSelectedId(e.target.value)}
                disabled={reevalBusy}
              >
                {reevalEvaluators.map((evaluator) => (
                  <option key={evaluator.id} value={evaluator.id}>
                    {evaluator.label} ({evaluator.model})
                  </option>
                ))}
              </select>
            ) : (
              <p className="reevaluate-error">No evaluators registered in the catalog.</p>
            )}
            {reevalError && <p className="reevaluate-error">{reevalError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-action approve"
                onClick={handleReevaluateRun}
                disabled={reevalBusy || !reevalSelectedId || reevalEvaluators.length === 0}
              >
                {reevalBusy ? "⏳ Re-evaluating..." : "🔄 Re-evaluate"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setReevalTargetRunId(null)}
                disabled={reevalBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
