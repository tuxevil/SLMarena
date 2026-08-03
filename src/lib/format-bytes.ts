export function formatBytes(bytes: number) {
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(0)} MB`;
  }

  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
