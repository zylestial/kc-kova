import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Inter's latin file (Google Fonts v20, every weight in one variable font;
// licence in ./fonts/Inter-OFL.txt), kept in the repo so `next dev` and
// builds never download it: a patchy connection made next/font/google fail
// with "Can't resolve '@vercel/turbopack-next/internal/font/google/font'".
// The CSS reads it through --font-inter.
const inter = localFont({ src: "./fonts/inter-latin.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "KOVA",
  description: "Kayelen's Operations and Vehicle Allocation.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { title: "KOVA", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

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
