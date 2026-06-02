import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Distributor OS",
  description: "AI B2B Order Execution OS for brands, distributors, and agents."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
