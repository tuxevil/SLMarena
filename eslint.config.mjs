import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next 16 exports flat configs directly; keep the legacy adapter out of the
// active config to avoid circular plugin objects under ESLint 9.
const nextConfig = [...nextCoreWebVitals, ...nextTypescript];

// The landing app is an isolated static-export workspace with its own
// toolchain; linting it with the root config would require duplicated deps.
const config = [
  ...nextConfig,
  {
    ignores: ["landing/**", "diag_*.ts", "enqueue_*.ts", "run_*.ts"],
  },
];

export default config;
