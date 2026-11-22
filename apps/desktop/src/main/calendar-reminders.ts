import ICAL from "ical.js";

/**
 * Lembrete de reunião: as próximas reuniões com link do Google Meet, lidas do
 * "Endereço secreto no formato iCal" do Google Calendar.
 *
 * Por que iCal e não a API: a API exige projeto no Google Cloud, OAuth e
 * verificação do app; o endereço secreto é um recurso do próprio Calendar
 * (Configurações → a agenda → Integrar agenda), só leitura, que a pessoa pode
 * revogar a qualquer momento. ical.js (Mozilla) expande recorrências, exceções
 * e fusos — reimplementar RRULE à mão é onde lembrete costuma errar.
 */

export type UpcomingMeeting = {
  /** uid + início: identifica a OCORRÊNCIA (reunião semanal tem um uid só). */
  key: string;
  title: string;
  startsAt: number;
  meetUrl: string;
  /** Quem convidou (nome ou e-mail), para o lembrete não esconder a origem. */
  organizer: string;
};

const MEET_LINK = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i;
/** Teto de ocorrências por evento recorrente: um diário de 2010 ainda chega a hoje. */
const MAX_OCCURRENCES = 50_000;

/** Só o endereço iCal do Google Calendar: nunca buscar URL arbitrária no main. */
export function isGoogleCalendarIcsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      url.hostname === "calendar.google.com" &&
      /^\/calendar\/ical\/[^/]+\/[^/]+\/basic\.ics$/.test(url.pathname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Dono da agenda (o e-mail no caminho do endereço iCal), ou null. */
export function calendarOwnerFromIcsUrl(value: string): string | null {
  try {
    const id = decodeURIComponent(new URL(value.trim()).pathname.split("/")[3] ?? "").toLowerCase();
    return id.includes("@") ? id : null;
  } catch {
    return null;
  }
}

const emailOf = (value: unknown): string =>
  String(value ?? "")
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();

function meetLinkOf(event: ICAL.Event): string {
  const component = event.component;
  const candidates = [
    String(component.getFirstPropertyValue("x-google-conference") ?? ""),
    event.location ?? "",
    event.description ?? "",
    String(component.getFirstPropertyValue("url") ?? ""),
  ];
  for (const text of candidates) {
    const match = MEET_LINK.exec(text);
    if (match) return match[0].toLowerCase();
  }
  return "";
}

function organizerOf(event: ICAL.Event): string {
  const property = event.component.getFirstProperty("organizer");
  if (!property) return "";
  const name = property.getParameter("cn");
  return (typeof name === "string" && name.trim()) || emailOf(property.getFirstValue());
}

/**
 * Evento que o dono da agenda recusou ou ainda não respondeu. O iCal secreto
 * traz também convites nunca aceitos: sem este filtro, qualquer pessoa que
 * mandasse um convite com o próprio link do Meet virava "Reunião em 1 min,
 * clique para entrar" — já logado, com câmera e microfone talvez liberados.
 */
function notAccepted(event: ICAL.Event, ownerEmail: string | null): boolean {
  if (!ownerEmail) return false;
  const component = event.component;
  const organizer = emailOf(component.getFirstPropertyValue("organizer"));
  if (organizer === ownerEmail) return false;
  for (const attendee of component.getAllProperties("attendee")) {
    if (emailOf(attendee.getFirstValue()) !== ownerEmail) continue;
    const status = String(attendee.getParameter("partstat") ?? "").toUpperCase();
    if (status === "DECLINED") return true;
    // Sem resposta: muita gente entra em reunião de colega sem responder o
    // convite. Lembra se quem convidou é da MESMA empresa (mesmo domínio,
    // não-público); de fora ou de e-mail público, só depois de aceitar.
    if (status === "NEEDS-ACTION") return !sameCompany(organizer, ownerEmail);
    return false;
  }
  return false;
}

/** Domínios de e-mail pessoal: "mesmo domínio" ali não diz nada sobre quem é. */
const PUBLIC_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "uol.com.br",
  "bol.com.br",
]);

function sameCompany(a: string, b: string): boolean {
  const domainA = a.split("@")[1] ?? "";
  const domainB = b.split("@")[1] ?? "";
  return Boolean(domainA) && domainA === domainB && !PUBLIC_MAIL.has(domainA);
}

function cancelled(event: ICAL.Event): boolean {
  return String(event.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

/**
 * Reuniões com link do Meet que começam em [from, to). Eventos de dia inteiro,
 * cancelados e não aceitos ficam de fora; exceção de uma série (mudou horário,
 * cancelou um dia) vale no lugar da ocorrência original.
 */
export function upcomingMeetings(
  ics: string,
  from: number,
  to: number,
  opts: { ownerEmail?: string | null } = {},
): UpcomingMeeting[] {
  const ownerEmail = opts.ownerEmail?.toLowerCase() ?? null;
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const zone of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(zone);
    } catch {
      /* fuso malformado: o evento cai para UTC/flutuante */
    }
  }
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const component of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException()) exceptions.push(event);
    else if (event.uid) masters.set(event.uid, event);
  }
  for (const exception of exceptions) {
    const master = masters.get(exception.uid);
    if (master) master.relateException(exception);
  }

  const out: UpcomingMeeting[] = [];
  const seen = new Set<string>();
  const push = (item: ICAL.Event, start: ICAL.Time): void => {
    if (start.isDate || cancelled(item) || notAccepted(item, ownerEmail)) return;
    const startsAt = start.toJSDate().getTime();
    if (startsAt < from || startsAt >= to) return;
    const meetUrl = meetLinkOf(item);
    if (!meetUrl) return;
    const key = `${item.uid}@${startsAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      key,
      title: (item.summary || "Reunião").trim().slice(0, 200),
      startsAt,
      meetUrl,
      organizer: organizerOf(item).slice(0, 120),
    });
  };

  for (const event of masters.values()) {
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      push(event, event.startDate);
      continue;
    }
    // Série que acabou (UNTIL) antes da janela: nada a expandir. É o caso comum
    // de agenda antiga, e expandir cada uma desde o início é o que custa CPU.
    const rule = event.component.getFirstPropertyValue("rrule") as ICAL.Recur | null;
    if (rule?.until && rule.until.toJSDate().getTime() < from) continue;
    const iterator = event.iterator();
    for (let index = 0, next = iterator.next(); next && index < MAX_OCCURRENCES; index++) {
      const at = next.toJSDate().getTime();
      if (at >= to) break;
      // Ocorrência ainda antes da janela: pular sem montar detalhes (o caro).
      // Uma ocorrência antiga MOVIDA para dentro da janela vem pelas exceções.
      if (at >= from) {
        const details = event.getOccurrenceDetails(next);
        push(details.item, details.startDate);
      }
      next = iterator.next();
    }
  }
  // Exceções pelo próprio horário novo: uma reunião ADIANTADA para dentro da
  // janela tem a ocorrência original depois do fim dela, e o laço acima para
  // antes de chegar lá. Também cobre exceção sem mestre no arquivo.
  for (const exception of exceptions) {
    if (exception.startDate) push(exception, exception.startDate);
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}

/** De quanto em quanto tempo a agenda é relida (e o erro diz quando tenta de novo). */
export const CALENDAR_REFRESH_MS = 5 * 60_000;
const RETRY_TEXT = `Tento de novo em ${CALENDAR_REFRESH_MS / 60_000} minutos.`;

/**
 * Erro da leitura da agenda em linguagem de quem configura. O motivo mais comum
 * é colar o endereço PÚBLICO (só existe com a agenda pública) no lugar do
 * secreto: o Google responde 404.
 */
export function calendarErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const http = /\bhttp:(\d{3})\b/.exec(text);
  if (http) {
    const status = Number(http[1]);
    if (status === 404 || status === 410) {
      return 'Endereço não encontrado. Use o "Endereço secreto no formato iCal" (o público não funciona) e cole de novo.';
    }
    if (status === 401 || status === 403) {
      return "O Google recusou o endereço. Gere um novo endereço secreto no Calendar e cole aqui.";
    }
    return `O Google Calendar respondeu ${status}. ${RETRY_TEXT}`;
  }
  if (/redirecionou para fora/i.test(text)) return text;
  if (/abort|timeout|demorou/i.test(text)) return `A agenda demorou demais para responder. ${RETRY_TEXT}`;
  if (/fetch|network|ENOTFOUND|ECONN|ERR_/i.test(text)) {
    return `Sem conexão com o Google Calendar agora. ${RETRY_TEXT}`;
  }
  return `Não foi possível ler a agenda (${text.slice(0, 80)}).`;
}
