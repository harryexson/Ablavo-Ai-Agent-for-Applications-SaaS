import { AgentClient, fromEndpoint } from "@ablavo/sdk";
import { type WidgetController, type WidgetOptions, mountWidget } from "./index";

/**
 * Script-tag entry:
 *   <script src="https://api.example.com/sdk/widget.js" data-session-endpoint="/api/agent-session" async></script>
 * or programmatic: window.AgentWidget.mount({ apiUrl, sessionEndpoint })
 * Marketing demo: data-demo="true" (sandbox session on the sample app, no host backend needed).
 */
declare global {
  interface Window {
    AgentWidget?: { mount: (o: WidgetOptions) => WidgetController; AgentClient: typeof AgentClient; instance?: WidgetController };
  }
}

const script = document.currentScript as HTMLScriptElement | null;
const apiUrl = script?.dataset.apiUrl ?? (script?.src ? new URL(script.src).origin : location.origin);

window.AgentWidget = {
  mount: (o) => (window.AgentWidget!.instance = mountWidget(o)),
  AgentClient,
};

function autoMount() {
  if (!script) return;
  const d = script.dataset;
  const base: Partial<WidgetOptions> = {
    mode: d.mode as WidgetOptions["mode"],
    theme: d.theme as WidgetOptions["theme"],
    language: d.language,
    open: d.open === "true",
    hideLauncher: d.hideLauncher === "true",
  };
  if (d.demo === "true") {
    window.AgentWidget!.mount({
      apiUrl,
      ...base,
      getSessionToken: fromEndpoint(`${apiUrl}/v1/demo/session`, { credentials: "omit", headers: { "content-type": "application/json" }, body: "{}" }),
    });
  } else if (d.sessionEndpoint) {
    window.AgentWidget!.mount({ apiUrl, ...base, sessionEndpoint: d.sessionEndpoint });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
else autoMount();
