"use client";

import type { TestRun } from "@/lib/contracts";

export type ActiveTab = "analytics" | "wizard" | "history" | "settings";

interface TopbarNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  activeRun: TestRun | null;
  ollamaUrl: string;
}

export function TopbarNav({ activeTab, onTabChange, activeRun, ollamaUrl }: TopbarNavProps) {
  const isRunActive = activeRun && ["PENDING", "RUNNING"].includes(activeRun.status);

  return (
    <header className="topbar-nav">
      <div className="topbar-left">
        <div className="brand-mark">SLM</div>
        <div className="brand-title-group">
          <span className="brand-title">SLMArena</span>
          <span className="brand-badge">v1.4</span>
        </div>
      </div>

      <nav className="topbar-menu">
        <button
          type="button"
          className={`topbar-item ${activeTab === "analytics" ? "active" : ""}`}
          onClick={() => onTabChange("analytics")}
        >
          <span className="nav-icon">📊</span>
          <span className="nav-label">Arena &amp; Analytics</span>
        </button>

        <button
          type="button"
          className={`topbar-item ${activeTab === "wizard" ? "active" : ""}`}
          onClick={() => onTabChange("wizard")}
        >
          <span className="nav-icon">🚀</span>
          <span className="nav-label">New Run</span>
          <span className="nav-pill">Wizard</span>
        </button>

        <button
          type="button"
          className={`topbar-item ${activeTab === "history" ? "active" : ""}`}
          onClick={() => onTabChange("history")}
        >
          <span className="nav-icon">📑</span>
          <span className="nav-label">History &amp; Failures</span>
          {isRunActive && <span className="nav-status-pulse" title="Live run..." />}
        </button>

        <button
          type="button"
          className={`topbar-item ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => onTabChange("settings")}
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">Settings</span>
        </button>
      </nav>

      <div className="topbar-right">
        {isRunActive ? (
          <div className="topbar-active-run-pill" onClick={() => onTabChange("history")}>
            <span className="dot pulse" />
            <span className="text">Live Run ({activeRun.results.filter((r) => r.status === "COMPLETED").length}/{activeRun.results.length})</span>
          </div>
        ) : (
          <div className="header-status-pill">
            <span className="dot online" />
            <span>Ollama: <code className="mono">{ollamaUrl}</code></span>
          </div>
        )}
      </div>
    </header>
  );
}
