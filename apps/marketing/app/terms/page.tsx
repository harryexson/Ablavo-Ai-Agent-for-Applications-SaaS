import type { Metadata } from "next";
import { Legal } from "@/components/Legal";

export const metadata: Metadata = { title: "Terms of service" };
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";

export default function Terms() {
  return (
    <Legal title="Terms of service" updated="November 2026">
      <p>These terms govern your use of {product}. By creating an account you agree to them on behalf of yourself and the organization you represent.</p>
      <h2>Accounts and workspaces</h2>
      <p>You are responsible for your credentials, for the members you invite and the roles you grant, and for keeping secret API keys on your servers.</p>
      <h2>Your content and your users</h2>
      <p>You keep all rights to the content you upload and to your end users' data. You grant us the rights needed to host and process it to provide the service. You confirm you are authorized to share the knowledge sources and user information you send us.</p>
      <h2>Actions</h2>
      <p>The assistant performs only actions you register, through endpoints you control. You are responsible for authorizing each request on your side and for the effects of actions your application performs.</p>
      <h2>Subscriptions and billing</h2>
      <p>Paid plans renew monthly or annually until cancelled. Usage beyond your plan's allowance is billed at the published per-message rate unless you set a spending cap. Cancellations take effect at the end of the current period; fees already paid are non-refundable except where required by law.</p>
      <h2>Acceptable use</h2>
      <p>Don't use the service to break the law, infringe others' rights, attack systems, or attempt to access other customers' data.</p>
      <h2>Availability and liability</h2>
      <p>The service is provided as is. To the extent permitted by law our aggregate liability is limited to the fees you paid in the twelve months before the claim.</p>
      <h2>Changes</h2>
      <p>We'll notify you of material changes to these terms at least 30 days in advance.</p>
    </Legal>
  );
}
