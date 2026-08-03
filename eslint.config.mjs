import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next 16 exports flat configs directly; keep the legacy adapter out of the
// active config to avoid circular plugin objects under ESLint 9.
const nextConfig = [...nextCoreWebVitals, ...nextTypescript];

export default nextConfig;
