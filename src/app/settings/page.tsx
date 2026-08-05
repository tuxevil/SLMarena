"use client";

import { useEffect, useState } from "react";
import { TopbarNav } from "@/components/layout/topbar-nav";
import { SettingsPanel } from "@/components/settings/settings-panel";

export default function SettingsPage() {
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [evaluatorBaseUrl, setEvaluatorBaseUrl] = useState("");
  const [evaluatorModel, setEvaluatorModel] = useState("");
  const [evaluatorApiKey, setEvaluatorApiKey] = useState("");
  const [evaluatorKeyConfigured, setEvaluatorKeyConfigured] = useState(false);
  const [parameters, setParameters] = useState({
    temperature: "0.2",
    numCtx: "8192",
    topP: "0.9",
    repeatPenalty: "1.1",
    numPredict: "512",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            setOllamaUrl(data.settings.ollamaUrl || "http://127.0.0.1:11434");
            setEvaluatorBaseUrl(data.settings.evaluatorBaseUrl || "");
            setEvaluatorModel(data.settings.evaluatorModel || "");
            setEvaluatorKeyConfigured(Boolean(data.settings.evaluatorApiKeyConfigured));
            if (data.settings.parameters) {
              setParameters({
                temperature: String(data.settings.parameters.temperature ?? "0.2"),
                numCtx: String(data.settings.parameters.numCtx ?? "8192"),
                topP: String(data.settings.parameters.topP ?? "0.9"),
                repeatPenalty: String(data.settings.parameters.repeatPenalty ?? "1.1"),
                numPredict: String(data.settings.parameters.numPredict ?? "512"),
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadSettings();
  }, []);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setNotice(undefined);
    try {
      const payload: Record<string, unknown> = {
        ollamaUrl,
        evaluatorBaseUrl: evaluatorBaseUrl.trim(),
        evaluatorModel: evaluatorModel.trim(),
        parameters: {
          temperature: Number(parameters.temperature),
          numCtx: Number(parameters.numCtx),
          topP: Number(parameters.topP),
          repeatPenalty: Number(parameters.repeatPenalty),
          numPredict: Number(parameters.numPredict),
        },
      };

      if (evaluatorApiKey.trim()) {
        payload.evaluatorApiKey = evaluatorApiKey.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setEvaluatorApiKey("");
        setEvaluatorKeyConfigured(Boolean(evaluatorApiKey.trim() || evaluatorKeyConfigured));
      } else {
        const err = await res.json();
        setNotice(err.error || "Could not save settings.");
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      setNotice("Connection error while saving.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="shell">
      <TopbarNav activeTab="settings" ollamaUrl={ollamaUrl} />
      <SettingsPanel
        ollamaUrl={ollamaUrl}
        onOllamaUrlChange={setOllamaUrl}
        evaluatorBaseUrl={evaluatorBaseUrl}
        onEvaluatorBaseUrlChange={setEvaluatorBaseUrl}
        evaluatorModel={evaluatorModel}
        onEvaluatorModelChange={setEvaluatorModel}
        evaluatorApiKey={evaluatorApiKey}
        onEvaluatorApiKeyChange={setEvaluatorApiKey}
        evaluatorKeyConfigured={evaluatorKeyConfigured}
        parameters={parameters}
        onParametersChange={setParameters}
        onSaveSettings={handleSaveSettings}
        isSaving={isSaving}
        notice={notice}
      />
    </main>
  );
}