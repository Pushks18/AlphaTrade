import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ComputeX — Decentralized GPU Compute & AI Model Marketplace",
  description: "Rent GPU compute, train AI models, mint them as iNFTs, and execute autonomous trades — all onchain via 0G Chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
