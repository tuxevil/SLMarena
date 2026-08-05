"use client";

import { useState } from "react";
import type { LeaderboardModelRow } from "@/lib/contracts";

interface QualitySpeedScatterPlotProps {
  models: LeaderboardModelRow[];
}

export function QualitySpeedScatterPlot({ models }: QualitySpeedScatterPlotProps) {
  const [hoveredModel, setHoveredModel] = useState<LeaderboardModelRow | null>(null);

  if (models.length === 0) {
    return <div className="chart-empty-state">No models selected</div>;
  }

  const width = 500;
  const height = 280;
  const padding = 40;

  const validModels = models.filter((m) => m.avgTokPerSec != null);
  if (validModels.length === 0) {
    return (
      <div className="chart-empty-state">
        Requires speed (tok/s) and Arena Score data to chart.
      </div>
    );
  }

  const maxTok = Math.max(...validModels.map((m) => m.avgTokPerSec!), 60);
  const minScore = 0;
  const maxScore = 100;

  const getX = (tok: number) => padding + (tok / maxTok) * (width - 2 * padding);
  const getY = (score: number) =>
    height - padding - ((score - minScore) / (maxScore - minScore)) * (height - 2 * padding);
  const getRadius = (paramVal: number) => Math.max(6, Math.min(22, Math.sqrt(paramVal) * 4));

  const colors = ["#c8f26b", "#6366f1", "#f5ba64", "#ff7b7b", "#8b5cf6", "#06b6d4", "#ec4899"];

  return (
    <div className="scatter-plot-container">
      <svg viewBox={`0 0 ${width} ${height}`} className="scatter-svg">
        {/* Grid lines (Y = Arena Score) */}
        {[0, 25, 50, 75, 100].map((s) => (
          <g key={s}>
            <line
              x1={padding}
              y1={getY(s)}
              x2={width - padding}
              y2={getY(s)}
              stroke="var(--line)"
              strokeDasharray="3 3"
              strokeWidth="0.5"
            />
            <text x={padding - 8} y={getY(s) + 4} fill="var(--muted)" fontSize="9" textAnchor="end">
              {s}
            </text>
          </g>
        ))}

        {/* Speed ticks (X = tok/s) */}
        {[0, Math.round(maxTok / 2), Math.round(maxTok)].map((v) => (
          <g key={v}>
            <line
              x1={getX(v)}
              y1={padding}
              x2={getX(v)}
              y2={height - padding}
              stroke="var(--line)"
              strokeDasharray="3 3"
              strokeWidth="0.5"
            />
            <text
              x={getX(v)}
              y={height - padding + 14}
              fill="var(--muted)"
              fontSize="9"
              textAnchor="middle"
            >
              {v} tok/s
            </text>
          </g>
        ))}

        {/* Bubbles */}
        {validModels.map((m, idx) => {
          const cx = getX(m.avgTokPerSec!);
          const cy = getY(m.arenaIndex);
          const r = getRadius(m.paramSizeValue);
          const color = colors[idx % colors.length];
          const isHovered = hoveredModel?.modelName === m.modelName;

          return (
            <g
              key={m.modelName}
              onMouseEnter={() => setHoveredModel(m)}
              onMouseLeave={() => setHoveredModel(null)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? r + 3 : r}
                fill={color}
                fillOpacity={isHovered ? "0.9" : "0.6"}
                stroke={color}
                strokeWidth={isHovered ? "2.5" : "1.5"}
              />
              <text
                x={cx}
                y={cy - r - 4}
                fill="var(--ink)"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {m.modelName}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hoveredModel && (
        <div className="scatter-tooltip">
          <div className="title">{hoveredModel.modelName}</div>
          <div>
            Parameters: <span className="mono">{hoveredModel.paramSizeLabel}</span>
          </div>
          <div>
            Speed: <span className="mono speed">{hoveredModel.avgTokPerSec} tok/s</span>
          </div>
          <div>
            Quality: <span className="star">{hoveredModel.avgQualityStars ?? 0} ★</span>
          </div>
          <div>
            Security (ASR): <span className="danger">{hoveredModel.attackSuccessRatePct ?? 0}%</span>
          </div>
          <div>
            Arena Score: <span className="mono highlight">{hoveredModel.arenaIndex}/100</span>
          </div>
        </div>
      )}
    </div>
  );
}
