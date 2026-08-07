"use client";

import { useSnapshot } from "@/lib/use-snapshot";
import { Navigation } from "@/components/Navigation";
import { ScenariosView } from "@/components/ScenariosView";
import { ExportSection } from "@/components/ExportSection";

export default function ScenariosPage() {
  const { data, error } = useSnapshot();

  if (error) {
    return (
      <div className="shell">
        <Navigation />
        <div className="empty-state fatal">
          <p>⚠️ Could not load the public snapshot.</p>
          <p className="muted-text">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell">
        <Navigation />
        <div className="loading-state">
          <div className="spinner" aria-hidden="true" />
          <p>Loading SLMarena snapshot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Navigation />
      <ScenariosView scenarios={data.scenarios} />
      <ExportSection snapshot={data} />
      <footer className="site-footer">
        SLMarena · scenario suite public by design · judge{" "}
        {data.global_stats.default_evaluator_model} ·{" "}
        <a
          className="footer-link"
          href="https://github.com/tuxevil/SLMarena"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/tuxevil/SLMarena ↗
        </a>
      </footer>
    </div>
  );
}
