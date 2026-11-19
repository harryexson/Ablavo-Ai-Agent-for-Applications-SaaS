import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/Site";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";

export const metadata: Metadata = {
  title: { default: `${product} — AI onboarding and training inside your app`, template: `%s · ${product}` },
  description: "Give your users an AI guide that helps them get started, learn your software, configure features and complete tasks — without leaving your application.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen bg-bg antialiased">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
