/**
 * Não lidas a partir do `title` da pasta no painel do Outlook web:
 * "Caixa de Entrada - 11.555 itens (6.771 não lidos)".
 *
 * O Outlook web numa aba comum nunca chama `navigator.setAppBadge` (medido com
 * milhares de não lidos e notificações permitidas), e o título da página não
 * traz contador. O painel de pastas é a fonte que sobra.
 *
 * Pasta que não é a caixa de entrada (ou título em outro formato): `null`, e
 * quem chama mantém o valor anterior. Caixa de entrada sem "(N não lidos)": 0.
 *
 * shortcut: lista de rótulos por idioma, como no Gmail. Outlook em idioma fora
 * da lista fica sem contador; acrescentar o rótulo e a palavra "não lidos" aqui.
 */
const INBOX = /^(caixa de entrada|inbox|bandeja de entrada|posteingang)\s+-\s/i;
const UNREAD = /\((\d{1,3}(?:[.,\s]\d{3})+|\d+)\s+(?:não lidos?|unread|no leídos?|ungelesen)\)\s*$/i;

export function unreadFromOutlookFolderTitle(title: string): number | null {
  const text = String(title || "").trim();
  if (!INBOX.test(text)) return null;
  const match = text.match(UNREAD);
  if (!match) return 0;
  return Math.min(99999, Number(match[1]!.replace(/\D/g, "")));
}
