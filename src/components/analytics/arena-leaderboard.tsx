"use client";

import type { LeaderboardModelRow, LeaderboardWeights } from "@/lib/contracts";

interface ArenaLeaderboardProps {
  models: LeaderboardModelRow[];
  category: "ALL" | "GENERAL" | "SECURITY";
  onCategoryChange: (cat: "ALL" | "GENERAL" | "SECURITY") => void;
  paramRange: "All" | "<4B" | "4B-8B" | ">8B";
  onParamRangeChange: (range: "All" | "<4B" | "4B-8B" | ">8B") => void;
  weights: LeaderboardWeights;
  onWeightChange: (key: keyof LeaderboardWeights, val: number) => void;
  selectedRadarModels: string[];
  onToggleRadarModel: (modelName: string) => void;
  onCompareModel?: (modelName: string) => void;
}

export function ArenaLeaderboard({
  models,
  category,
  onCategoryChange,
  paramRange,
  onParamRangeChange,
  weights,
  onWeightChange,
  selectedRadarModels,
  onToggleRadarModel,
  onCompareModel,
}: ArenaLeaderboardProps) {
  return (
    <div className="leaderboard-card">
      <div className="leaderboard-header-section">
        <div className="title-and-filters">
          <div>
            <h3 className="card-title">🏆 Arena Leaderboard &amp; Custom Weighting</h3>
            <p className="card-subtitle">
              Calculate the Arena Index by customizing the weighting between Quality, Security, and Speed.
            </p>
          </div>

          <div className="filters-row">
            <div className="filter-group">
              <label>Category:</label>
              <select value={category} onChange={(e) => onCategoryChange(e.target.value as "ALL" | "GENERAL" | "SECURITY")}>
                <option value="ALL">All Categories</option>
                <option value="GENERAL">General / Reasoning</option>
                <option value="SECURITY">Security Tests</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Parameter Size:</label>
              <select value={paramRange} onChange={(e) => onParamRangeChange(e.target.value as "All" | "<4B" | "4B-8B" | ">8B")}>
                <option value="All">All Sizes</option>
                <option value="<4B">&lt; 4B Parameters</option>
                <option value="4B-8B">4B - 8B Parameters</option>
                <option value=">8B">&gt; 8B Parameters</option>
              </select>
            </div>
          </div>
        </div>

        {/* Sliders Panel */}
        <div className="arena-sliders-grid">
          <div className="slider-control">
            <div className="slider-label-row">
              <span className="slider-name quality">⭐ LLM Quality (wq)</span>
              <span className="slider-val">{weights.quality}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weights.quality}
              onChange={(e) => onWeightChange("quality", Number(e.target.value))}
              className="slider-input quality"
            />
          </div>

          <div className="slider-control">
            <div className="slider-label-row">
              <span className="slider-name security">🛡️ ASR Security (ws)</span>
              <span className="slider-val">{weights.security}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weights.security}
              onChange={(e) => onWeightChange("security", Number(e.target.value))}
              className="slider-input security"
            />
          </div>

          <div className="slider-control">
            <div className="slider-label-row">
              <span className="slider-name speed">⚡ Speed (wv)</span>
              <span className="slider-val">{weights.speed}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weights.speed}
              onChange={(e) => onWeightChange("speed", Number(e.target.value))}
              className="slider-input speed"
            />
          </div>
        </div>
      </div>

      {models.length === 0 ? (
        <div className="leaderboard-empty">
          <span>No model results found for the selected filters.</span>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th style={{ width: "48px", textAlign: "center" }}>Radar</th>
                <th># Rank</th>
                <th>Local Model</th>
                <th>Size</th>
                <th>Speed</th>
                <th>Avg TTFT</th>
                <th>Quality (★)</th>
                <th>ASR (Vulnerability)</th>
                <th style={{ textAlign: "right" }}>Arena Index</th>
                {onCompareModel && <th style={{ textAlign: "center" }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {models.map((m, idx) => {
                const isChecked = selectedRadarModels.includes(m.modelName);
                const rank = idx + 1;
                const rankBadge =
                  rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
                const isFailing = (m.attackSuccessRatePct ?? 0) > 0 || (m.avgQualityStars ?? 5) < 3;

                return (
                  <tr key={m.modelName} className={isFailing ? "row-warning" : ""}>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleRadarModel(m.modelName)}
                        title="Compare on Radar chart"
                      />
                    </td>
                    <td className="rank-cell">{rankBadge}</td>
                    <td className="model-name-cell">
                      <span className="name">{m.modelName}</span>
                      {isFailing && <span className="fail-tag">⚠️ Unstable/Discard</span>}
                    </td>
                    <td>
                      <span className="param-badge">{m.paramSizeLabel}</span>
                    </td>
                    <td className="speed-cell">
                      {m.avgTokPerSec != null ? `${m.avgTokPerSec} tok/s` : "—"}
                    </td>
                    <td className="ttft-cell">
                      {m.avgTtftMs != null ? `${m.avgTtftMs} ms` : "—"}
                    </td>
                    <td className="quality-cell">
                      {m.avgQualityStars != null ? `${m.avgQualityStars} ★` : "—"}
                    </td>
                    <td>
                      {m.attackSuccessRatePct != null ? (
                        <span
                          className={`asr-badge ${
                            m.attackSuccessRatePct > 40
                              ? "high"
                              : m.attackSuccessRatePct > 0
                              ? "medium"
                              : "low"
                          }`}
                        >
                          {m.attackSuccessRatePct}%
                        </span>
                      ) : (
                        <span className="muted-text">0%</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="arena-index-pill">
                        {m.arenaIndex} / 100
                      </span>
                    </td>
                    {onCompareModel && (
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="btn-compact-action"
                          onClick={() => onCompareModel(m.modelName)}
                        >
                          🔍 Detail
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
