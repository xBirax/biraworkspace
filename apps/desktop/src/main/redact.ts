/** Redact secrets before writing logs or exporting diagnostics. */
const PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]"],
  [/auth_token=([^;\s&]+)/gi, "auth_token=[REDACTED]"],
  [/tenant_id=([^;\s&]+)/gi, "tenant_id=[REDACTED]"],
  [/adr_impersonation_session=([^;\s&]+)/gi, "adr_impersonation_session=[REDACTED]"],
  [/"auth_token"\s*:\s*"[^"]*"/gi, '"auth_token":"[REDACTED]"'],
  [/"token"\s*:\s*"[^"]*"/gi, '"token":"[REDACTED]"'],
  [/"password"\s*:\s*"[^"]*"/gi, '"password":"[REDACTED]"'],
  [/"cookie"\s*:\s*"[^"]*"/gi, '"cookie":"[REDACTED]"'],
  // Cookie de login de terceiro: o diagnóstico do Spotify loga NOME de cookie de
  // propósito, mas nada garante que um log futuro não pegue o valor junto.
  [/\b(sp_dc|sp_key|sp_t|sid|hsid|ssid|apisid|sapisid)=([^;\s&"]+)/gi, "$1=[REDACTED]"],
  [/set-cookie["\s:]+[^;\n]+/gi, "set-cookie: [REDACTED]"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[JWT_REDACTED]"],
  // Token OAuth do Google fora de URL (header, corpo).
  [/\bya29\.[A-Za-z0-9_-]+/g, "[GOOGLE_TOKEN_REDACTED]"],
  // Query string inteira some: é lá que vão access_token, code, sig, key — e os
  // dados de pessoa do handoff do CRM (vincularTelefone, vincularNome). Para o
  // diagnóstico basta o caminho.
  [/(https?:\/\/[^\s"'?#]+)\?[^\s"'#]*/gi, "$1?[query]"],
  // O fragmento também carrega segredo: fluxos OAuth implícitos devolvem
  // `#access_token=…`/`#code=…`, e o Gmail põe a busca e o id da conversa ali.
  [/(https?:\/\/[^\s"'#]+)#[^\s"']*/gi, "$1#[fragment]"],
  // mailto:/tel: inteiros são dado de pessoa (endereço, assunto, corpo, número).
  [/\b(mailto|tel|sms):[^\s"']+/gi, "$1:[REDACTED]"],
];

export function redactSecrets(input: string): string {
  let out = String(input ?? "");
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/** JSON.stringify estoura em estrutura circular e em BigInt — e pushLog é
 *  chamado de dentro de handlers de evento, onde a exceção derruba o handler. */
function describe(extra: unknown): string {
  if (typeof extra === "string") return extra;
  try {
    return JSON.stringify(extra) ?? String(extra);
  } catch {
    return "[não serializável]";
  }
}

export function safeLogLine(level: string, message: string, extra?: unknown): string {
  const payload = extra === undefined ? message : `${message} ${describe(extra)}`;
  return `${new Date().toISOString()} [${level}] ${redactSecrets(payload)}`;
}
