/**
 * Prompt-injection defenses for ingested content. Documentation is DATA: we neutralize text that
 * tries to address the model as instructions, and flag it so developers can review the source.
 * The orchestrator additionally wraps all retrieved text in delimited, quoted context blocks.
 */
const INJECTION_PATTERNS: { flag: string; re: RegExp }[] = [
  { flag: "override_instructions", re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|all|system|earlier)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|messages?)\b/gi },
  { flag: "role_hijack", re: /\b(you are now|act as|pretend to be|from now on you)\b[^.\n]{0,80}/gi },
  { flag: "system_prompt_probe", re: /\b(reveal|print|show|repeat|output)\b[^.\n]{0,30}\b(system prompt|hidden instructions|your instructions)\b/gi },
  { flag: "fake_role_marker", re: /^\s*(system|assistant|developer)\s*:/gim },
  { flag: "tool_coercion", re: /\b(call|invoke|execute|run)\b[^.\n]{0,20}\b(tool|function|action)\b[^.\n]{0,60}\b(without|no)\b[^.\n]{0,20}\b(confirm|confirmation|asking|permission)\b/gi },
  { flag: "exfiltration", re: /\b(send|post|upload|exfiltrate)\b[^.\n]{0,60}\b(api key|secret|token|password|credentials)\b/gi },
];

export interface SanitizeResult {
  text: string;
  flags: string[];
}

export function detectInjection(text: string): string[] {
  const flags = new Set<string>();
  for (const { flag, re } of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) flags.add(flag);
  }
  return [...flags];
}

export function sanitizeContent(text: string): SanitizeResult {
  const flags = detectInjection(text);
  if (flags.length === 0) return { text, flags };
  let out = text;
  for (const { re } of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, "[removed: instruction-like text]");
  }
  return { text: out, flags };
}
