import type { Metadata } from "next";
import { Legal } from "@/components/Legal";

export const metadata: Metadata = { title: "Privacy policy" };
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";

export default function Privacy() {
  return (
    <Legal title="Privacy policy" updated="November 2026">
      <p>This policy explains what {product} collects, why, and the choices you have. It covers our website, developer console and the assistant we run inside our customers' applications.</p>
      <h2>Information we collect</h2>
      <p>Account data (name, email, hashed password), workspace and billing details processed by our payment provider, content you upload as knowledge sources, and usage data such as API requests and feature usage. Inside customer applications we process the end-user identifiers, roles and messages our customer sends us.</p>
      <h2>How we use it</h2>
      <p>To provide and secure the service, answer end users from the customer's knowledge, meter usage and bill, and improve reliability. We do not sell personal information, and we do not use customer content to train foundation models.</p>
      <h2>AI providers and subprocessors</h2>
      <p>Customers choose which AI providers may process their data. Content is sent only to providers a customer has enabled. Infrastructure, email and payment subprocessors process data on our behalf under written agreements.</p>
      <h2>Retention and deletion</h2>
      <p>Customers set conversation retention in their workspace settings. Workspaces and accounts can be exported or deleted at any time from the console.</p>
      <h2>Your rights</h2>
      <p>Depending on where you live you may access, correct, export or delete your personal data, and object to certain processing. End users of our customers' applications should contact that customer first; we assist them as their processor.</p>
      <h2>Contact</h2>
      <p>Questions about privacy can be sent through our <a className="text-brand" href="/contact">contact form</a>.</p>
    </Legal>
  );
}
