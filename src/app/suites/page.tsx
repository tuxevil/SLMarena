"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopbarNav } from "@/components/layout/topbar-nav";
import { TestSuitesMatrix } from "@/components/suites/test-suites-matrix";
import type { TestCategory, SecurityAttackType, BenchmarkParameters, TestRun } from "@/lib/contracts";

export default function SuitesPage() {
  const router = useRouter();
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.settings?.ollamaUrl) {
            setOllamaUrl(data.settings.ollamaUrl);
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadSettings();
  }, []);

  const handleLaunchRun = async (params: {
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    userMessages: string[];
    models: string[];
    parameters: BenchmarkParameters;
    samplesPerModel: number;
    scenarioId?: string | null;
  }) => {
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ollamaUrl,
          scenarioId: params.scenarioId || null,
          samplesPerModel: params.samplesPerModel,
          category: params.category,
          attackType: params.attackType,
          systemPrompt: params.systemPrompt,
          userMessages: params.userMessages,
          models: params.models,
          parameters: params.parameters,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setActiveRun(data.run);
        // Navigate to /monitor to watch live execution stream
        router.push("/monitor");
      } else {
        const err = await res.json();
        alert(`Error starting benchmark: ${err.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Error launching benchmark:", err);
      alert("Could not connect to server to start benchmark.");
    }
  };

  return (
    <main className="shell">
      <TopbarNav activeTab="suites" activeRun={activeRun} ollamaUrl={ollamaUrl} />
      <TestSuitesMatrix ollamaUrl={ollamaUrl} onLaunchRun={handleLaunchRun} />
    </main>
  );
}