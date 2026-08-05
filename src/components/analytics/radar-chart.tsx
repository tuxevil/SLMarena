"use client";

import type { LeaderboardModelRow } from "@/lib/contracts";

interface SecurityRadarChartProps {
  models: LeaderboardModelRow[];
}

export function SecurityRadarChart({ models }: SecurityRadarChartProps) {
  if (models.length === 0) {
    return (
      <div className="chart-empty-state">
        <p>No models selected for Radar comparison.</p>
        <p className="sub">Select checkboxes in the Leaderboard table to chart.</p>
      </div>
    );
  }

  const width = 360;
  const height = 280;
  const cx = width / 2;
  const cy = height / 2 - 10;
  const radius = 90;

  const axes = [
    { label: "Instruction Override", key: "instructionOverrideResistance" as const, angle: -Math.PI / 2 },
    { label: "System Prompt Leakage", key: "systemPromptLeakageResistance" as const, angle: 0 },
    { label: "Indirect Injection", key: "indirectInjectionDefense" as const, angle: Math.PI / 2 },
    { label: "System Adherence", key: "systemPromptAdherence" as const, angle: Math.PI },
  ];

  const colors = ["#c8f26b", "#6366f1", "#f5ba64", "#ff7b7b", "#8b5cf6", "#06b6d4"];

  const getPoint = (val: number, angle: number) => {
    const r = (val / 100) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  return (
    <div className="radar-chart-container">
      <svg viewBox={`0 0 ${width} ${height}`} className="radar-svg">
        {/* Concentric grid polygons */}
        {[0.25, 0.5, 0.75, 1.0].map((level) => {
          const points = axes
            .map((a) => {
              const pt = getPoint(level * 100, a.angle);
              return `${pt.x},${pt.y}`;
            })
            .join(" ");
          return (
            <polygon
              key={level}
              points={points}
              fill="none"
              stroke="var(--line)"
              strokeDasharray="2 2"
              strokeWidth="0.8"
            />
          );
        })}

        {/* Axis lines and labels */}
        {axes.map((a) => {
          const pt = getPoint(100, a.angle);
          const labelPt = getPoint(118, a.angle);
          return (
            <g key={a.label}>
              <line x1={cx} y1={cy} x2={pt.x} y2={pt.y} stroke="var(--line)" strokeWidth="1" />
              <text
                x={labelPt.x}
                y={labelPt.y + 3}
                fill="var(--muted)"
                fontSize="9"
                fontWeight="500"
                textAnchor={
                  Math.abs(labelPt.x - cx) < 10
                    ? "middle"
                    : labelPt.x > cx
                    ? "start"
                    : "end"
                }
              >
                {a.label}
              </text>
            </g>
          );
        })}

        {/* Polygons for each model */}
        {models.map((m, idx) => {
          const color = colors[idx % colors.length];
          const points = axes
            .map((a) => {
              const val = m.radar[a.key] ?? 100;
              const pt = getPoint(val, a.angle);
              return `${pt.x},${pt.y}`;
            })
            .join(" ");

          return (
            <g key={m.modelName}>
              <polygon
                points={points}
                fill={color}
                fillOpacity="0.25"
                stroke={color}
                strokeWidth="2"
              />
              {axes.map((a) => {
                const val = m.radar[a.key] ?? 100;
                const pt = getPoint(val, a.angle);
                return <circle key={a.key} cx={pt.x} cy={pt.y} r="3" fill={color} />;
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="radar-legend">
        {models.map((m, idx) => {
          const color = colors[idx % colors.length];
          return (
            <div key={m.modelName} className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: color }} />
              <span>{m.modelName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
