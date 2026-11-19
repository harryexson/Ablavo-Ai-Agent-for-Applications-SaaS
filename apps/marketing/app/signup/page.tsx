import type { Metadata } from "next";
import { SignupForm } from "@/components/Auth";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default function Page() {
  return <SignupForm />;
}
