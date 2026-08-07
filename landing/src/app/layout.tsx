import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLMarena — Public Leaderboard",
  description:
    "Public leaderboard of local small language models benchmarked under adversarial, SecOps and general scenarios.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
