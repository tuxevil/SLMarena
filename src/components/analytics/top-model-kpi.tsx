"use client";

import type { LeaderboardModelRow } from "@/lib/contracts";

interface TopModelKpiProps {
  models: LeaderboardModelRow[];
  totalRuns: number;
}

export function TopModelKpi({ models, totalRuns }: TopModelKpiProps) {
  const topModel = models.length > 0 ? models[0] : null;

  // Identify models that failed or are vulnerable (ASR > 0% or avgQualityStars < 3)
  const vulnerableOrFailingModels = models.filter(
    (m) => (m.attackSuccessRatePct != null && m.attackSuccessRatePct > 0) || (m.avgQualityStars != null && m.avgQualityStars < 3)
  );

  return (
    <div className="kpi-hero-grid">
      {/* 🏆 Top Model Winner KPI Card */}
      <div className="kpi-card top-winner-card">
        <div className="kpi-header">
          <div className="kpi-title-row">
            <span className="kpi-icon">🏆</span>
            <span className="kpi-title">Top Winning SLM Model</span>
          </div>
          <span className="kpi-badge gold">🥇 Rank #1</span>
        </div>

        {topModel ? (
          <div className="top-winner-body">
            <div className="winner-main-info">
              <span className="winner-name">{topModel.modelName}</span>
              <span className="winner-size-tag">{topModel.paramSizeLabel}</span>
            </div>

            <div className="winner-metrics-strip">
              <div className="metric-cell">
                <span className="metric-label">Arena Index</span>
                <span className="metric-value highlight">{topModel.arenaIndex} / 100</span>
              </div>
              <div className="metric-cell">
                <span className="metric-label">LLM Judge Quality</span>
                <span className="metric-value star">
                  {topModel.avgQualityStars != null ? `${topModel.avgQualityStars} ★` : "N/A"}
                </span>
              </div>
              <div className="metric-cell">
                <span className="metric-label">Speed</span>
                <span className="metric-value speed">
                  {topModel.avgTokPerSec != null ? `${topModel.avgTokPerSec} tok/s` : "N/A"}
                </span>
              </div>
              <div className="metric-cell">
                <span className="metric-label">ASR Vulnerability</span>
                <span className={`metric-value ${topModel.attackSuccessRatePct && topModel.attackSuccessRatePct > 0 ? "danger" : "safe"}`}>
                  {topModel.attackSuccessRatePct != null ? `${topModel.attackSuccessRatePct}%` : "0% (Safe)"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="kpi-empty-state">
            <span>Not enough evaluated runs to determine the leading model.</span>
          </div>
        )}
      </div>

      {/* ⚠️ Discard & Failures Summary Card */}
      <div className="kpi-card failure-summary-card">
        <div className="kpi-header">
          <div className="kpi-title-row">
            <span className="kpi-icon">⚠️</span>
            <span className="kpi-title">Discards &amp; Security Failures</span>
          </div>
          <span className="kpi-badge alert">{vulnerableOrFailingModels.length} Discarded</span>
        </div>

        <div className="failure-summary-body">
          <div className="failure-stat-row">
            <div className="stat-box">
              <span className="stat-number">{models.length}</span>
              <span className="stat-desc">Evaluated Models</span>
            </div>
            <div className="stat-box danger">
              <span className="stat-number">{vulnerableOrFailingModels.length}</span>
              <span className="stat-desc">With Failures / Vulnerable</span>
            </div>
            <div className="stat-box">
              <span className="stat-number">{totalRuns}</span>
              <span className="stat-desc">Recorded Runs</span>
            </div>
          </div>

          {vulnerableOrFailingModels.length > 0 ? (
            <div className="vulnerable-list-compact">
              <span className="list-title">Models to Discard:</span>
              <div className="vulnerable-chips">
                {vulnerableOrFailingModels.map((m) => (
                  <span key={m.modelName} className="vuln-chip">
                    🚨 {m.modelName} (ASR: {m.attackSuccessRatePct ?? 0}%, {m.avgQualityStars ?? 0}★)
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="vulnerable-empty">
              <span>✅ No vulnerabilities or critical failures detected in evaluated models.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
