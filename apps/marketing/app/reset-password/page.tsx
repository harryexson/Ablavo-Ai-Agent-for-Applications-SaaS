import type { Metadata } from "next";
import { ResetForm } from "@/components/Auth";

export const metadata: Metadata = { title: "Reset password", robots: { index: false } };

export default function Page() {
  return <ResetForm />;
}
