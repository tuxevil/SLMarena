"use client";

import { useEffect, useState } from "react";
import type {
  AnomalyDashboard,
  EmptyResponseAnomaly,
  FailedEvalAnomaly,
  TpsOutlierAnomaly,
} from "@/lib/anomalies";
import { TPS_ZSCORE_THRESHOLD } from "@/lib/anomalies";

interface AnomaliesPanelProps {
  pollIntervalMs?: number;
}

async function fetchAnomalies(): Promise<AnomalyDashboard> {
  const res = await fetch("/api/anomalies");
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Failed to load anomalies.");
  }
  return res.json() as Promise<AnomalyDashboard>;
}

export function AnomaliesPanel({ pollIntervalMs = 30_000 }: AnomaliesPanelProps) {
  const [dashboard, setDashboard] = useState<AnomalyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyResultId, setBusyResultId] = useState<string | null>(null);

  useEffect(() => {
    function applyDashboard(payload: AnomalyDashboard) {
      setDashboard(payload);
      setError(null);
    }
    function reportError(err: unknown) {
      console.error("Failed to load anomalies:", err);
      setError(err instanceof Error ? err.message : "Failed to load anomalies.");
    }
    fetchAnomalies()
      .then(applyDashboard)
      .catch(reportError)
      .finally(() => setLoading(false));
    const timer = setInterval(() => {
      fetchAnomalies().then(applyDashboard).catch(reportError);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [pollIntervalMs]);

  const handleRefresh = () => {
    fetchAnomalies()
      .then((payload) => {
        setDashboard(payload);
        setError(null);
      })
      .catch((err) => {
        console.error("Failed to load anomalies:", err);
        setError(err instanceof Error ? err.message : "Failed to load anomalies.");
      });
  };

  const handleReevaluate = async (anomaly: FailedEvalAnomaly) => {
    if (!anomaly.retryable) return;
    setBusyResultId(anomaly.resultId);
    try {
      const res = await fetch(`/api/results/${encodeURIComponent(anomaly.resultId)}/reevaluate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Re-evaluation failed.");
      }
      setDashboard(await fetchAnomalies());
    } catch (err) {
      console.error("Failed to re-evaluate result:", err);
      alert(err instanceof Error ? err.message : "Re-evaluation failed.");
    } finally {
      setBusyResultId(null);
    }
  };

  const counts = dashboard?.counts;
  const emptyResponses = dashboard?.emptyResponses ?? [];
  const failedEvals = dashboard?.failedEvals ?? [];
  const tpsOutliers = dashboard?.tpsOutliers ?? [];

  return (
    <div className="panel anomalies-panel">
      <div className="controls-header">
        <div>
          <h2>Dashboard de Anomalías</h2>
          <p className="mono">
            {dashboard ? `Actualizado ${new Date(dashboard.generatedAt).toLocaleTimeString()}` : "Cargando…"}
          </p>
        </div>
        <div className="anomaly-counts-row">
          <span className="anomaly-count-badge warn">{counts?.emptyResponses ?? "–"} vacías</span>
          <span className="anomaly-count-badge danger">{counts?.failedEvals ?? "–"} evals fallidas</span>
          <span className="anomaly-count-badge info">{counts?.tpsOutliers ?? "–"} outliers tps</span>
          <button className="btn-compact-action" onClick={handleRefresh} disabled={loading}>
            {loading ? "…" : "Refrescar"}
          </button>
        </div>
      </div>

      {error && <p className="anomaly-error">{error}</p>}
      {loading && !dashboard ? (
        <p className="anomaly-empty">Cargando anomalías…</p>
      ) : (
        <>
          <AnomalySection title="1. Respuestas vacías / near-zero" hint="Modelo × escenario, longitud < 15 caracteres" total={counts?.emptyResponses ?? 0}>
            <EmptyResponsesTable items={emptyResponses} shown={(counts?.emptyResponses ?? 0) > emptyResponses.length} />
          </AnomalySection>
          <AnomalySection title="2. Evaluaciones fallidas" hint="FAILED u orquestadas RUNNING en runs terminados" total={counts?.failedEvals ?? 0}>
            <FailedEvalsTable items={failedEvals} shown={(counts?.failedEvals ?? 0) > failedEvals.length} busyResultId={busyResultId} onReevaluate={handleReevaluate} />
          </AnomalySection>
          <AnomalySection title="3. Outliers de telemetría (tps)" hint={`|z-score| > ${TPS_ZSCORE_THRESHOLD} vs promedio del modelo (o máximo posible para n muestras, mín. 5)`} total={counts?.tpsOutliers ?? 0}>
            <TpsOutliersTable items={tpsOutliers} shown={(counts?.tpsOutliers ?? 0) > tpsOutliers.length} />
          </AnomalySection>
        </>
      )}
    </div>
  );
}

function AnomalySection({ title, hint, total, children }: { title: string; hint: string; total: number; children: React.ReactNode }) {
  return (
    <div className="control-section">
      <div className="anomaly-section-header">
        <div>
          <h3>{title}</h3>
          <p className="muted">{hint}</p>
        </div>
        <span className="anomaly-total">{total}</span>
      </div>
      {total === 0 ? <p className="anomaly-empty">Sin anomalías detectadas.</p> : children}
    </div>
  );
}

function EmptyResponsesTable({ items, shown }: { items: EmptyResponseAnomaly[]; shown: boolean }) {
  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Escenario</th>
          <th>Modelo</th>
          <th>Muestra</th>
          <th>Longitud</th>
          <th>Respuesta</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.resultId}>
            <td className="mono">{new Date(item.runCreatedAt).toLocaleString()}</td>
            <td>{item.scenarioName ?? "—"}</td>
            <td>{item.modelName}</td>
            <td className="mono">#{item.sampleIndex + 1}</td>
            <td className="mono">{item.responseLength} chars</td>
            <td className="anomaly-excerpt" title={item.responseExcerpt}>{item.responseExcerpt}</td>
          </tr>
        ))}
        {shown && (
          <tr>
            <td colSpan={6} className="anomaly-more">Hay más anomalías…</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function FailedEvalsTable({ items, shown, busyResultId, onReevaluate }: { items: FailedEvalAnomaly[]; shown: boolean; busyResultId: string | null; onReevaluate: (item: FailedEvalAnomaly) => void }) {
  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Escenario</th>
          <th>Modelo</th>
          <th>Muestra</th>
          <th>Estado</th>
          <th>Error</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.resultId}>
            <td className="mono">{new Date(item.runCreatedAt).toLocaleString()}</td>
            <td>{item.scenarioName ?? "—"}</td>
            <td>{item.modelName}</td>
            <td className="mono">#{item.sampleIndex + 1}</td>
            <td>
              <span className={item.evalStatus === "FAILED" ? "fail-tag" : "anomaly-running-tag"}>
                {item.evalStatus === "FAILED" ? "FAILED" : "RUNNING huérfano"}
              </span>
            </td>
            <td className="anomaly-excerpt" title={item.errorMessage ?? ""}>{item.errorMessage ?? "—"}</td>
            <td>
              <button
                className="btn-compact-action"
                disabled={!item.retryable || busyResultId === item.resultId}
                onClick={() => onReevaluate(item)}
              >
                {busyResultId === item.resultId ? "Re-evaluando…" : item.retryable ? "Re-evaluate" : "Sin respuesta"}
              </button>
            </td>
          </tr>
        ))}
        {shown && (
          <tr>
            <td colSpan={7} className="anomaly-more">Hay más anomalías…</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function TpsOutliersTable({ items, shown }: { items: TpsOutlierAnomaly[]; shown: boolean }) {
  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Escenario</th>
          <th>Modelo</th>
          <th>Muestra</th>
          <th>tps</th>
          <th>z-score</th>
          <th>Promedio modelo</th>
          <th>Muestras</th>
          <th>Contexto (in/out)</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.resultId}>
            <td className="mono">{new Date(item.runCreatedAt).toLocaleString()}</td>
            <td>{item.scenarioName ?? "—"}</td>
            <td>{item.modelName}</td>
            <td className="mono">#{item.sampleIndex + 1}</td>
            <td className="mono">{item.tokPerSec.toFixed(1)}</td>
            <td className={`mono ${item.zScore < 0 ? "fail-tag" : "anomaly-high-tag"}`}>
              {item.zScore > 0 ? "+" : ""}{item.zScore.toFixed(2)}
            </td>
            <td className="mono">{item.modelMeanTokPerSec.toFixed(1)} ± {item.modelStdDevTokPerSec.toFixed(1)}</td>
            <td className="mono">{item.modelSampleSize}</td>
            <td className="mono">{item.inputTokens ?? "–"}/{item.outputTokens ?? "–"}</td>
          </tr>
        ))}
        {shown && (
          <tr>
            <td colSpan={9} className="anomaly-more">Hay más anomalías…</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
