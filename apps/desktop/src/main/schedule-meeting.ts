/**
 * "Agendar reunião" a partir de uma conversa (painel do CRM no WhatsApp).
 *
 * Sem API e sem token, como o "Salvar no Google": abre o formulário de evento
 * do Google Calendar já preenchido, e quem revisa e salva é a pessoa. `vcon=meet`
 * pede a sala do Google Meet junto com o evento (parâmetro do próprio Calendar,
 * não documentado — se o Google o ignorar, o evento abre sem sala e o botão
 * "Adicionar videoconferência" continua lá).
 */

const CALENDAR_TEMPLATE = "https://calendar.google.com/calendar/render";

export function calendarEventTemplateUrl(input: {
  title: string;
  details?: string;
  guestEmail?: string | null;
  /** Conta Google (e-mail ou índice) para abrir o formulário na agenda certa. */
  authuser?: string | null;
}): string {
  const url = new URL(CALENDAR_TEMPLATE);
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", input.title.trim().slice(0, 200) || "Reunião");
  if (input.details?.trim()) url.searchParams.set("details", input.details.trim().slice(0, 1500));
  const guest = input.guestEmail?.trim() ?? "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest)) url.searchParams.set("add", guest);
  url.searchParams.set("vcon", "meet");
  if (input.authuser?.trim()) url.searchParams.set("authuser", input.authuser.trim());
  return url.toString();
}

/** Título e descrição do evento a partir da conversa do WhatsApp. */
export function meetingFromChat(chat: { name?: unknown; phone?: unknown }): {
  title: string;
  details: string;
} {
  const name = typeof chat.name === "string" ? chat.name.trim().slice(0, 120) : "";
  const phone = typeof chat.phone === "string" ? chat.phone.trim().slice(0, 40) : "";
  const who = name || phone || "contato do WhatsApp";
  const details = [
    `Reunião agendada a partir da conversa no WhatsApp com ${who}${name && phone ? ` (${phone})` : ""}.`,
  ];
  return { title: `Reunião com ${who}`, details: details.join("\n") };
}
