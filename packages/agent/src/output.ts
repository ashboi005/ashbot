export type Redactor = (text: string) => string;

const REDACTED = "[REDACTED]";
const MIN_KNOWN_SECRET_LENGTH = 6;

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, `$1${REDACTED}@`],
  [
    /\b([A-Za-z0-9_.-]*(?:secret|password|passwd|token|api[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*)("?\s*[:=]\s*)("?)([^\s"',;}]+)/gi,
    `$1$2$3${REDACTED}`,
  ],
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createRedactor(knownSecrets: string[]): Redactor {
  const known = [...new Set(knownSecrets)]
    .filter((secret) => secret.length >= MIN_KNOWN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length)
    .map((secret) => new RegExp(escapeRegExp(secret), "g"));

  return (text) => {
    let result = text;
    for (const pattern of known) result = result.replace(pattern, REDACTED);
    for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
    return result;
  };
}

export function truncate(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  const head = new TextDecoder().decode(bytes.subarray(0, maxBytes)).replace(/�$/, "");
  return `${head}\n…[truncated: ${bytes.length - maxBytes} more bytes]`;
}

export function prepareOutput(value: unknown, opts: { redact: Redactor; maxBytes: number }): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return truncate(opts.redact(text), opts.maxBytes);
}
