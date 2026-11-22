/**
 * Salvar contato do WhatsApp no Google Contacts.
 *
 * Abrir o formulário de novo contato já preenchido, no navegador do usuário, e
 * deixar ele revisar e salvar. Sem API, sem token, sem projeto no Google Cloud.
 *
 * A primeira versão fazia OAuth + People API e criava o contato direto. Foi
 * removida (está em `3f72f99` se um dia o salvamento em um clique fizer falta):
 * o OAuth do Google não pode autenticar em user agent incorporado, para contas
 * pessoais ou Google Workspace. Em modo Testing, refresh tokens também podem
 * expirar após 7 dias. O fluxo atual abre o formulário no navegador externo e
 * deixa o usuário revisar o contato antes de salvar.
 */

/**
 * Formulário de novo contato do Google já preenchido. Grafias medidas ao vivo
 * no navegador:
 *
 * - `givenname` cai no campo Nome. Só esta forma funciona — `name`,
 *   `given_name`, `firstName` e `first_name` são ignorados.
 * - `phone` cai no Telefone. Com `+DDI` o Google acerta o país sozinho (testado
 *   com +86, marcou China), então mandamos sempre em E.164.
 * - `authuser` escolhe a conta, para não abrir na errada de quem tem várias
 *   logadas no navegador.
 *
 * ponytail: parâmetro não documentado pelo Google. Se parar de preencher, é
 * aqui — e o pior caso é o formulário abrir vazio, não quebrar.
 */
export function newContactUrl(
  name: string | null | undefined,
  phone: string,
  email?: string,
): string {
  const params = new URLSearchParams();
  const trimmed = String(name || "").trim();
  if (trimmed) params.set("givenname", trimmed);
  if (phone) params.set("phone", phone);
  if (email) params.set("authuser", email);
  return `https://contacts.google.com/new?${params.toString()}`;
}

/** Telefone do WhatsApp vem só em dígitos; o formulário acerta o país com E.164. */
export function toE164(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}
