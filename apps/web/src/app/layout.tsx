import type { Metadata } from "next";
import { Source_Sans_3, Syne } from "next/font/google";

import "./globals.css";

const display = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});

const body = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Porchline",
  description: "Operator dashboard for Porchline",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} min-h-screen font-sans antialiased`}>{children}</body>
    </html>
  );
}
