import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";

export const metadata: Metadata = { title: { default: `${product} Console`, template: `%s · ${product} Console` }, robots: { index: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen bg-bg">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
