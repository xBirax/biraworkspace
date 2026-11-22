// Helpers puros compartilhados pela extensao. Manter este arquivo sem APIs do Chrome/DOM
// permite testar os contratos criticos sem carregar o WhatsApp Web.
(function exposeCrmWaUtils(root) {
  const TRANSCRIPT_CACHE_LIMIT = 200;
  const TRANSCRIPT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeTitle(value) {
    return normalizeText(value).toLocaleLowerCase("pt-BR");
  }

  function normalizeComposerText(value) {
    return String(value || "")
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .replaceAll("\u00a0", " ")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .trim();
  }

  function chatKey(identity, title) {
    const id = String(identity?.id || "").trim();
    if (id) return `jid:${id}`;
    const phone = String(identity?.phone || "").replace(/\D/g, "");
    if (phone) return `phone:${phone}`;
    const normalizedTitle = normalizeTitle(title);
    return normalizedTitle ? `title:${normalizedTitle}` : "";
  }

  // O cabecalho do WhatsApp mostra o PROPRIO NUMERO quando o contato nao esta na agenda,
  // e esse titulo vinha como nome da pessoa: o registro nascia com alguem chamado
  // "+55 11 98237-6057". Sem nome e melhor que nome falso (secao 178.6).
  function isRealName(title) {
    return Boolean(String(title ?? "").replace(/[\d\s+()\-.]/g, ""));
  }

  // "Pessoa | Empresa", "Nome - Label" -> a PESSOA e a EMPRESA separadas. Sem isto o
  // titulo inteiro vai para o campo de nome nos dois handoffs (negocio e pessoa).
  // Hifen so separa com espaco dos dois lados: "Ana-Maria Souza" e um nome so.
  function titleParts(title) {
    const parts = String(title ?? "")
      .split(/\s*[|–—•·]\s*|\s+-\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const person = parts[0] || "";
    return {
      person: isRealName(person) ? person : "",
      company: parts.length > 1 && isRealName(parts[1]) ? parts[1] : "",
    };
  }

  // Linha em branco não entra na conta: o Lexical devolve no innerText um número
  // de quebras diferente do que recebeu colado, e a tradução de mensagem com
  // espaçamento era sempre desfeita como se o texto tivesse mudado.
  // Mesma regra de isSameComposerText em packages/crm-core.
  function isSameComposerText(actual, expected) {
    const lines = (value) =>
      normalizeComposerText(value)
        .split("\n")
        .filter((line) => line.trim())
        .join("\n");
    return lines(actual) === lines(expected);
  }

  function normalizeTranscriptCache(value, now = Date.now()) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const cutoff = currentTime - TRANSCRIPT_CACHE_TTL_MS;

    return Object.fromEntries(
      Object.entries(source)
        .filter(([externalId, entry]) => {
          const text = typeof entry?.text === "string" ? entry.text.trim() : "";
          const updatedAt = Number(entry?.updatedAt);
          return !!externalId.trim() && !!text && Number.isFinite(updatedAt) && updatedAt >= cutoff;
        })
        .sort((left, right) => Number(right[1].updatedAt) - Number(left[1].updatedAt))
        .slice(0, TRANSCRIPT_CACHE_LIMIT)
        .map(([externalId, entry]) => [
          externalId,
          { text: entry.text.trim().slice(0, 20_000), updatedAt: Number(entry.updatedAt) },
        ])
    );
  }

  function upsertTranscriptCache(value, externalId, text, now = Date.now()) {
    const key = String(externalId || "").trim();
    const normalizedText = String(text || "").trim();
    const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const current = normalizeTranscriptCache(value, currentTime);
    if (!key || key.length > 512 || !normalizedText) return current;

    return normalizeTranscriptCache(
      { ...current, [key]: { text: normalizedText.slice(0, 20_000), updatedAt: currentTime } },
      currentTime
    );
  }

  root.CRMWAUtils = Object.freeze({
    chatKey,
    isRealName,
    isSameComposerText,
    normalizeComposerText,
    normalizeTranscriptCache,
    normalizeText,
    normalizeTitle,
    titleParts,
    upsertTranscriptCache,
  });
})(globalThis);
