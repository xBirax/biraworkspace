/**
 * Não lidas a partir do título do Gmail: "Caixa de entrada (12) - fulano@x - Gmail".
 *
 * O contador só é aceito quando o primeiro trecho é a caixa de entrada. Sem
 * isso, um assunto como "Orçamento (2) - fulano@x - Gmail" (título da view de
 * conversa, mesmo formato) viraria "2 e-mails não lidos".
 *
 * Fora da caixa de entrada (conversa aberta, busca, outro rótulo, carregando)
 * o título não diz nada: `null`, e quem chama mantém o valor anterior. Devolver
 * 0 ali fazia cada "abrir e-mail → voltar" ser um 0→12, que re-notificava os
 * mesmos 12 não lidos — o aviso "voltava" depois de Limpar.
 *
 * ponytail: lista de rótulos por idioma. Gmail em idioma fora da lista nunca
 * tem contador — o recurso fica quieto em vez de errado. Acrescentar o rótulo aqui.
 */
const INBOX_LABEL = /^(caixa de entrada|inbox|bandeja de entrada|posteingang)\b/i;

export function unreadFromGmailTitle(title: string): number | null {
  const first = String(title || "").split(" - ")[0]?.trim() || "";
  if (!INBOX_LABEL.test(first)) return null;
  // Milhar vem com separador do idioma: "(1,234)", "(1.234)", "(1 234)" (\s cobre o espaço fino/NBSP).
  const match = first.match(/\((\d{1,3}(?:[.,\s]\d{3})+|\d+)\)\s*$/);
  if (!match) return 0;
  return Math.min(99999, Number(match[1]!.replace(/\D/g, "")));
}
