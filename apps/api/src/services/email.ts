import type { Config } from "../config";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Sends through Resend when RESEND_API_KEY is set; otherwise logs (and keeps the last messages for dev/tests). */
export class EmailService {
  readonly outbox: OutgoingEmail[] = [];
  constructor(private readonly config: Config) {}

  get configured() {
    return Boolean(this.config.resendApiKey);
  }

  async send(email: OutgoingEmail): Promise<void> {
    if (!this.config.resendApiKey) {
      this.outbox.push(email);
      if (this.outbox.length > 50) this.outbox.shift();
      if (this.config.env === "development") console.info(`[email:dev] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.config.emailFrom, to: [email.to], subject: email.subject, text: email.text }),
    });
    if (!res.ok) throw new Error(`Email delivery failed: ${res.status}`);
  }
}
