import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compare / Local model benchmark",
  description: "Benchmark and review local language models side by side.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
