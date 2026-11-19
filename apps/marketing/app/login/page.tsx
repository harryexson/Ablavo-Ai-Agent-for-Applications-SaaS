import type { Metadata } from "next";
import { LoginForm } from "@/components/Auth";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function Page() {
  return <LoginForm />;
}
