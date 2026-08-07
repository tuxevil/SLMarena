"use client";

import { useEffect, useState } from "react";
import type { PublicSnapshot } from "@/types/snapshot";

export interface SnapshotState {
  data: PublicSnapshot | null;
  error: string | null;
}

export function useSnapshot(): SnapshotState {
  const [data, setData] = useState<PublicSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/public-snapshot.json")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load snapshot (HTTP ${res.status})`);
        return res.json();
      })
      .then((payload: PublicSnapshot) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error };
}
