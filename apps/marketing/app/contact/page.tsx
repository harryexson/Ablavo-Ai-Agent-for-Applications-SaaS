"use client";
import { useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@ablavo/ui";
import { post } from "@/components/Auth";

export default function Contact() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto grid max-w-5xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
      <div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink">Talk to sales</h1>
        <p className="mt-4 text-lg text-ink-2">Enterprise security reviews, volume pricing, custom AI providers, SSO and agency partnerships.</p>
      </div>
      {state === "sent" ? (
        <Alert tone="ok">Thanks — we'll get back to you within one business day.</Alert>
      ) : (
        <form
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            setState("sending");
            setError(null);
            try {
              await post("/v1/contact", f);
              setState("sent");
            } catch (err) {
              setError((err as Error).message);
              setState("idle");
            }
          }}
        >
          {error && <Alert tone="err">{error}</Alert>}
          <Field label="Name" htmlFor="c-name">
            <Input id="c-name" name="name" required />
          </Field>
          <Field label="Work email" htmlFor="c-email">
            <Input id="c-email" name="email" type="email" required />
          </Field>
          <Field label="Company" htmlFor="c-company">
            <Input id="c-company" name="company" />
          </Field>
          <Field label="Monthly active users" htmlFor="c-size">
            <Select id="c-size" name="size" defaultValue="1k-10k">
              <option value="<1k">Under 1,000</option>
              <option value="1k-10k">1,000 – 10,000</option>
              <option value="10k-100k">10,000 – 100,000</option>
              <option value="100k+">100,000+</option>
            </Select>
          </Field>
          <Field label="What are you looking for?" htmlFor="c-msg">
            <Textarea id="c-msg" name="message" rows={4} required maxLength={4000} />
          </Field>
          <Button type="submit" size="lg" loading={state === "sending"}>
            Send
          </Button>
        </form>
      )}
    </main>
  );
}
