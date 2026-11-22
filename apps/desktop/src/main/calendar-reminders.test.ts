import { describe, expect, it } from "vitest";
import { calendarOwnerFromIcsUrl, isGoogleCalendarIcsUrl, upcomingMeetings } from "./calendar-reminders.js";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "BEGIN:VTIMEZONE",
  "TZID:America/Sao_Paulo",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0300",
  "TZOFFSETTO:-0300",
  "TZNAME:-03",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
  // Semanal às 10h (13h UTC), toda segunda, desde agosto.
  "BEGIN:VEVENT",
  "UID:semanal@google.com",
  "DTSTART;TZID=America/Sao_Paulo:20260803T100000",
  "DTEND;TZID=America/Sao_Paulo:20260803T103000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "SUMMARY:Daily comercial",
  "DESCRIPTION:Participar: https://meet.google.com/abc-defg-hij",
  "END:VEVENT",
  // A segunda 19/10 foi movida para as 15h.
  "BEGIN:VEVENT",
  "UID:semanal@google.com",
  "RECURRENCE-ID;TZID=America/Sao_Paulo:20261019T100000",
  "DTSTART;TZID=America/Sao_Paulo:20261019T150000",
  "DTEND;TZID=America/Sao_Paulo:20261019T153000",
  "SUMMARY:Daily comercial (remarcada)",
  "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:cliente@google.com",
  "DTSTART:20261020T170000Z",
  "DTEND:20261020T180000Z",
  "SUMMARY:Apresentação para cliente",
  "LOCATION:https://meet.google.com/xyz-abcd-efg",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:cancelada@google.com",
  "DTSTART:20261020T190000Z",
  "STATUS:CANCELLED",
  "SUMMARY:Cancelada",
  "DESCRIPTION:https://meet.google.com/qqq-wwww-eee",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:presencial@google.com",
  "DTSTART:20261020T120000Z",
  "SUMMARY:Almoço",
  "LOCATION:Restaurante",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:feriado@google.com",
  "DTSTART;VALUE=DATE:20261020",
  "SUMMARY:Dia inteiro com link",
  "DESCRIPTION:https://meet.google.com/aaa-bbbb-ccc",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const at = (iso: string) => Date.parse(iso);

describe("upcomingMeetings", () => {
  it("expande a série, aplica a exceção e ignora cancelada, sem Meet e dia inteiro", () => {
    const meetings = upcomingMeetings(ICS, at("2026-10-19T00:00:00Z"), at("2026-10-28T00:00:00Z"));
    expect(meetings.map((m) => [m.title, new Date(m.startsAt).toISOString(), m.meetUrl])).toEqual([
      ["Daily comercial (remarcada)", "2026-10-19T18:00:00.000Z", "https://meet.google.com/abc-defg-hij"],
      ["Apresentação para cliente", "2026-10-20T17:00:00.000Z", "https://meet.google.com/xyz-abcd-efg"],
      ["Daily comercial", "2026-10-26T13:00:00.000Z", "https://meet.google.com/abc-defg-hij"],
    ]);
  });

  it("cada ocorrência tem chave própria (o lembrete não repete nem pula semana)", () => {
    const meetings = upcomingMeetings(ICS, at("2026-10-01T00:00:00Z"), at("2026-11-01T00:00:00Z"));
    const keys = meetings.map((m) => m.key);
    // 5, 12, 19 (remarcada para 15h), 26 de outubro + a apresentação de 20/10.
    expect(keys).toEqual([
      `semanal@google.com@${at("2026-10-05T13:00:00Z")}`,
      `semanal@google.com@${at("2026-10-12T13:00:00Z")}`,
      `semanal@google.com@${at("2026-10-19T18:00:00Z")}`,
      `cliente@google.com@${at("2026-10-20T17:00:00Z")}`,
      `semanal@google.com@${at("2026-10-26T13:00:00Z")}`,
    ]);
  });

  it("janela vazia não devolve nada", () => {
    expect(upcomingMeetings(ICS, at("2026-10-21T00:00:00Z"), at("2026-10-21T01:00:00Z"))).toEqual([]);
  });
});

describe("isGoogleCalendarIcsUrl", () => {
  it.each([
    "https://calendar.google.com/calendar/ical/fulano%40gmail.com/private-abc123/basic.ics",
    "  https://calendar.google.com/calendar/ical/c_123%40group.calendar.google.com/private-x/basic.ics ",
  ])("aceita o endereço secreto do Google Calendar: %s", (url) => {
    expect(isGoogleCalendarIcsUrl(url)).toBe(true);
  });

  it.each([
    "http://calendar.google.com/calendar/ical/a/b/basic.ics",
    "https://calendar.google.com.evil.example/calendar/ical/a/b/basic.ics",
    "https://example.com/calendar/ical/a/b/basic.ics",
    "https://calendar.google.com/calendar/r",
    "file:///C:/agenda.ics",
    "não é url",
  ])("recusa outro endereço: %s", (url) => {
    expect(isGoogleCalendarIcsUrl(url)).toBe(false);
  });
});

describe("convites e exceções adiantadas", () => {
  const ics = (events: string[]) =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
  const OWNER = "eu@adr.com";

  it("lembra a reunião semanal adiantada para dentro da janela", () => {
    const text = ics([
      "BEGIN:VEVENT",
      "UID:serie@google.com",
      "DTSTART:20261007T190000Z",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Semanal 16h",
      "DESCRIPTION:https://meet.google.com/abc-defg-hij",
      "END:VEVENT",
      // Hoje (14/10) movida das 19h para as 18h UTC.
      "BEGIN:VEVENT",
      "UID:serie@google.com",
      "RECURRENCE-ID:20261014T190000Z",
      "DTSTART:20261014T180000Z",
      "SUMMARY:Semanal adiantada",
      "DESCRIPTION:https://meet.google.com/abc-defg-hij",
      "END:VEVENT",
    ]);
    // Janela 17:35–18:05: a ocorrência original (19h) está fora dela.
    const meetings = upcomingMeetings(text, at("2026-10-14T17:35:00Z"), at("2026-10-14T18:05:00Z"));
    expect(meetings.map((m) => m.title)).toEqual(["Semanal adiantada"]);
  });

  it("ignora convite recusado ou sem resposta, e mostra o organizador", () => {
    const event = (uid: string, partstat: string) => [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      "DTSTART:20261014T180000Z",
      `SUMMARY:${uid}`,
      "ORGANIZER;CN=Fulano:mailto:fulano@cliente.com",
      `ATTENDEE;PARTSTAT=${partstat}:mailto:${OWNER}`,
      "DESCRIPTION:https://meet.google.com/xyz-abcd-efg",
      "END:VEVENT",
    ];
    const text = ics([
      ...event("aceito", "ACCEPTED"),
      ...event("recusado", "DECLINED"),
      ...event("sem-resposta", "NEEDS-ACTION"),
    ]);
    const meetings = upcomingMeetings(text, at("2026-10-14T17:00:00Z"), at("2026-10-14T19:00:00Z"), {
      ownerEmail: OWNER,
    });
    expect(meetings.map((m) => [m.title, m.organizer])).toEqual([["aceito", "Fulano"]]);
  });

  it("descobre o dono da agenda pelo endereço iCal", () => {
    expect(
      calendarOwnerFromIcsUrl("https://calendar.google.com/calendar/ical/Eu%40ADR.com/private-x/basic.ics"),
    ).toBe("eu@adr.com");
    expect(calendarOwnerFromIcsUrl("https://calendar.google.com/calendar/ical/abc/private-x/basic.ics")).toBeNull();
  });
});

describe("convite sem resposta", () => {
  const invite = (organizer: string, owner: string) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:convite@google.com",
      "DTSTART:20261014T180000Z",
      "SUMMARY:Convite",
      `ORGANIZER:mailto:${organizer}`,
      `ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${owner}`,
      "DESCRIPTION:https://meet.google.com/xyz-abcd-efg",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  const window = [at("2026-10-14T17:00:00Z"), at("2026-10-14T19:00:00Z")] as const;

  it("lembra convite de colega da mesma empresa", () => {
    expect(
      upcomingMeetings(invite("chefe@adr.com.br", "eu@adr.com.br"), ...window, { ownerEmail: "eu@adr.com.br" }),
    ).toHaveLength(1);
  });

  it("não lembra convite de fora nem de e-mail público sem aceite", () => {
    expect(
      upcomingMeetings(invite("x@desconhecido.com", "eu@adr.com.br"), ...window, { ownerEmail: "eu@adr.com.br" }),
    ).toEqual([]);
    expect(
      upcomingMeetings(invite("golpe@gmail.com", "eu@gmail.com"), ...window, { ownerEmail: "eu@gmail.com" }),
    ).toEqual([]);
  });
});

describe("fusos com horário de verão e exceções canceladas", () => {
  const NEW_YORK = [
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  const calendar = (events: string[]) =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", ...NEW_YORK, ...events, "END:VCALENDAR"].join("\r\n");

  it("série às 10h de Nova York continua às 10h locais depois do fim do horário de verão", () => {
    const text = calendar([
      "BEGIN:VEVENT",
      "UID:ny@google.com",
      "DTSTART;TZID=America/New_York:20261026T100000",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Sync EUA",
      "DESCRIPTION:https://meet.google.com/abc-defg-hij",
      "END:VEVENT",
    ]);
    const meetings = upcomingMeetings(text, at("2026-10-25T00:00:00Z"), at("2026-11-04T00:00:00Z"));
    // 26/10 ainda em EDT (UTC-4); 2/11 já em EST (UTC-5).
    expect(meetings.map((m) => new Date(m.startsAt).toISOString())).toEqual([
      "2026-10-26T14:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
    ]);
  });

  it("exceção cancelada tira só aquela ocorrência", () => {
    const text = calendar([
      "BEGIN:VEVENT",
      "UID:serie2@google.com",
      "DTSTART:20261013T180000Z",
      "RRULE:FREQ=DAILY;COUNT=3",
      "SUMMARY:Diária",
      "DESCRIPTION:https://meet.google.com/abc-defg-hij",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:serie2@google.com",
      "RECURRENCE-ID:20261014T180000Z",
      "DTSTART:20261014T180000Z",
      "STATUS:CANCELLED",
      "SUMMARY:Diária",
      "END:VEVENT",
    ]);
    const meetings = upcomingMeetings(text, at("2026-10-13T00:00:00Z"), at("2026-10-16T00:00:00Z"));
    expect(meetings.map((m) => new Date(m.startsAt).toISOString())).toEqual([
      "2026-10-13T18:00:00.000Z",
      "2026-10-15T18:00:00.000Z",
    ]);
  });

  it("reunião que o próprio dono organizou nunca é filtrada", () => {
    const text = calendar([
      "BEGIN:VEVENT",
      "UID:minha@google.com",
      "DTSTART:20261014T180000Z",
      "SUMMARY:Minha reunião",
      "ORGANIZER:mailto:eu@adr.com",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:eu@adr.com",
      "DESCRIPTION:https://meet.google.com/abc-defg-hij",
      "END:VEVENT",
    ]);
    expect(
      upcomingMeetings(text, at("2026-10-14T17:00:00Z"), at("2026-10-14T19:00:00Z"), { ownerEmail: "eu@adr.com" }),
    ).toHaveLength(1);
  });
});

describe("agendas fora do padrão", () => {
  const at = (iso: string) => Date.parse(iso);
  const wrap = (lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");

  it("texto que não é iCal lança (a worker devolve ok:false e o painel mostra o erro)", () => {
    expect(() => upcomingMeetings("<html>login</html>", 0, Date.now())).toThrow();
  });

  it("TZID sem VTIMEZONE no arquivo não some nem quebra: cai em hora local, perto do horário certo", () => {
    const text = wrap([
      "BEGIN:VEVENT",
      "UID:sem-fuso@google.com",
      "DTSTART;TZID=America/Sao_Paulo:20261014T100000",
      "SUMMARY:Sem fuso",
      "DESCRIPTION:https://meet.google.com/abc-defg-hij",
      "END:VEVENT",
    ]);
    // 10h em São Paulo = 13h UTC; como hora flutuante, depende do fuso da
    // máquina — mas fica dentro de ±14 h, nunca some.
    const found = upcomingMeetings(text, at("2026-10-13T20:00:00Z"), at("2026-10-15T08:00:00Z"));
    expect(found).toHaveLength(1);
    expect(Math.abs(found[0]!.startsAt - at("2026-10-14T13:00:00Z"))).toBeLessThanOrEqual(14 * 60 * 60_000);
  });
});
