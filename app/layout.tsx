import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted at build time; the CSS reads it through --font-inter.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "KOVA",
  description: "Kayelen's Operations and Vehicle Allocation.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
