import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
// Only the CSS reaches the browser — the KaTeX JavaScript renderer runs
// server-side only, in components/uploads/render-math.ts (ADR-0005, M1
// AC 21). Imported once, here, so every page that renders an extracted
// problem's math gets the stylesheet without each one importing it itself.
import "katex/dist/katex.min.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s | Homework Helper",
    default: "Homework Helper — AI tutoring for your student",
  },
  description:
    "AI-powered homework tutoring built with parental consent and privacy for students at its core.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
