import type { AgentClient } from "@ablavo/sdk";
import { overlayCss } from "./styles";

export interface TourStep {
  id: string;
  title: string;
  content: string;
  uiTarget?: string;
  expectEvent?: string;
}

/**
 * Draws highlights and step tooltips over the host page. It only ever *reads* the position of
 * elements the host registered (data-agent-id) — it never clicks, types into or mutates host DOM.
 */
export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private spot: HTMLElement;
  private tip: HTMLElement;
  private target: HTMLElement | null = null;
  private raf = 0;

  constructor(private readonly client: AgentClient, primary: string) {
    this.host = document.createElement("div");
    this.host.setAttribute("data-agent-overlay", "");
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = overlayCss(primary);
    this.spot = document.createElement("div");
    this.spot.className = "spot";
    this.tip = document.createElement("div");
    this.tip.className = "tip";
    this.tip.setAttribute("role", "dialog");
    this.root.append(style);
    document.body.appendChild(this.host);
    window.addEventListener("resize", () => this.position());
    window.addEventListener("scroll", () => this.position(), true);
  }

  private position() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      if (!this.target || !this.target.isConnected) return;
      const r = this.target.getBoundingClientRect();
      const pad = 6;
      Object.assign(this.spot.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      if (this.tip.isConnected) {
        const below = r.bottom + 12 + 180 < window.innerHeight;
        const left = Math.min(Math.max(12, r.left), window.innerWidth - this.tip.offsetWidth - 12);
        Object.assign(this.tip.style, { left: `${left}px`, top: below ? `${r.bottom + 12}px` : "", bottom: below ? "" : `${window.innerHeight - r.top + 12}px` });
      }
    });
  }

  /** Briefly spotlights a registered element. Returns false when it is not on the page. */
  highlight(elementId: string, ms = 4000): boolean {
    const el = this.client.findElement(elementId);
    if (!el) return false;
    this.clear();
    this.target = el;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    this.spot.className = "spot soft";
    this.root.append(this.spot);
    this.position();
    setTimeout(() => this.position(), 350);
    window.setTimeout(() => {
      if (this.target === el && !this.tip.isConnected) this.clear();
    }, ms);
    return true;
  }

  /** Shows one tour step. `onNext` is omitted for learn-by-doing steps that wait for a host event. */
  showStep(step: TourStep, index: number, total: number, labels: { next: string; back: string; finish: string; waiting: string }, handlers: { onNext?: () => void; onBack?: () => void; onClose: () => void }) {
    this.clear();
    const el = step.uiTarget ? this.client.findElement(step.uiTarget) : null;
    this.target = el;
    this.tip.replaceChildren();
    const k = Object.assign(document.createElement("div"), { className: "k", textContent: `${index + 1} / ${total}` });
    const h = Object.assign(document.createElement("h5"), { textContent: step.title });
    const p = Object.assign(document.createElement("p"), { textContent: step.content });
    const row = Object.assign(document.createElement("div"), { className: "row" });
    const back = Object.assign(document.createElement("button"), { textContent: labels.back, disabled: index === 0 });
    back.addEventListener("click", () => handlers.onBack?.());
    const close = Object.assign(document.createElement("button"), { textContent: "✕", ariaLabel: "Close" });
    close.addEventListener("click", handlers.onClose);
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "6px";
    if (handlers.onNext) {
      const next = Object.assign(document.createElement("button"), { className: "primary", textContent: index === total - 1 ? labels.finish : labels.next });
      next.addEventListener("click", handlers.onNext);
      right.append(back, next);
    } else {
      right.append(back, Object.assign(document.createElement("span"), { className: "wait", textContent: labels.waiting }));
    }
    row.append(close, right);
    this.tip.append(k, h, p, row);
    if (el) {
      el.scrollIntoView({ block: "center" });
      this.spot.className = "spot";
      this.root.append(this.spot, this.tip);
      this.position();
    } else {
      Object.assign(this.tip.style, { left: "50%", top: "20%", bottom: "", transform: "translateX(-50%)" });
      this.root.append(this.tip);
    }
    (this.tip.querySelector("button.primary") as HTMLElement | null)?.focus();
  }

  clear() {
    this.target = null;
    this.tip.style.transform = "";
    this.spot.remove();
    this.tip.remove();
  }

  destroy() {
    this.clear();
    this.host.remove();
  }
}
