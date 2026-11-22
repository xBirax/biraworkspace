/**
 * Quem está numa reunião do Meet agora, e quando começou.
 *
 * Alimentado pela sonda de "na chamada" (MEET_IN_CALL_PROBE em meet.ts) de cada
 * aba do Meet. As transições é que interessam ao resto do app: começou → liga o
 * "não perturbe" e o atalho do microfone; terminou → desliga, e oferece registrar
 * a reunião no CRM. Sem Electron, para o teste cobrir as transições.
 */

export type MeetCall = { serviceId: string; room: string; startedAt: number };
export type MeetCallEnded = MeetCall & { endedAt: number };

export class MeetCallTracker {
  private readonly calls = new Map<string, MeetCall>();

  constructor(
    private readonly hooks: {
      onStart?: (call: MeetCall) => void;
      onEnd?: (call: MeetCallEnded) => void;
    } = {},
  ) {}

  /** Resultado de uma sonda: a aba `serviceId` está (ou não) na sala `room`. */
  update(serviceId: string, room: string, inCall: boolean, now = Date.now()): void {
    const current = this.calls.get(serviceId);
    if (inCall && room) {
      if (current && current.room === room) return;
      // Trocou de sala sem passar pela tela de saída: são duas reuniões.
      if (current) this.end(serviceId, now);
      const call = { serviceId, room, startedAt: now };
      this.calls.set(serviceId, call);
      this.hooks.onStart?.(call);
      return;
    }
    if (current) this.end(serviceId, now);
  }

  /** A aba sumiu (hibernou, fechou, foi excluída): a chamada dela acabou. */
  forget(serviceId: string, now = Date.now()): void {
    if (this.calls.has(serviceId)) this.end(serviceId, now);
  }

  isInCall(serviceId: string): boolean {
    return this.calls.has(serviceId);
  }

  get active(): boolean {
    return this.calls.size > 0;
  }

  activeCalls(): MeetCall[] {
    return [...this.calls.values()];
  }

  private end(serviceId: string, now: number): void {
    const call = this.calls.get(serviceId);
    if (!call) return;
    this.calls.delete(serviceId);
    this.hooks.onEnd?.({ ...call, endedAt: now });
  }
}

/** Duração legível para o registro no CRM ("45 min", "1 h 05 min"). */
export function formatMeetingDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")} min` : `${hours} h`;
}

/** Limites da mini-janela da chamada (ver meet-integration.ts). */
export const MINI_WINDOW = {
  minWidth: 240,
  maxWidth: 360,
  /** Fração da largura da área do serviço. */
  widthShare: 0.26,
  /** Altura/largura: o vídeo do Meet em 16:10 com a barra de controles. */
  aspect: 0.62,
  margin: 16,
  /** Acima do rodapé: o botão "ADR CRM" do Gmail fica no canto inferior esquerdo. */
  bottomGap: 72,
} as const;

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Onde a mini-janela fica dentro da área do serviço: canto inferior ESQUERDO (o
 * direito tem o botão de enviar do WhatsApp e o painel do CRM). `null` quando a
 * área é pequena demais para caber sem cobrir o serviço inteiro.
 */
export function miniWindowBounds(main: Rect): Rect | null {
  if (main.width < 640 || main.height < 420) return null;
  const width = Math.round(
    Math.min(MINI_WINDOW.maxWidth, Math.max(MINI_WINDOW.minWidth, main.width * MINI_WINDOW.widthShare)),
  );
  const height = Math.round(width * MINI_WINDOW.aspect);
  return {
    x: main.x + MINI_WINDOW.margin,
    y: Math.max(main.y + 8, main.y + main.height - height - MINI_WINDOW.bottomGap),
    width,
    height,
  };
}

/**
 * Plano dos lembretes de uma leitura da agenda: o que avisa já (passou da hora
 * do aviso, a reunião ainda não começou) e o que agenda para depois. Ocorrência
 * já avisada não repete; o registro de avisadas esquece o que passou há mais de
 * 1 h (o app fica aberto por semanas).
 */
export function planReminders(
  meetings: ReadonlyArray<{ key: string; startsAt: number }>,
  reminded: Map<string, number>,
  now: number,
  leadMs: number,
): { now: string[]; later: Array<[string, number]> } {
  for (const [key, startsAt] of reminded) if (startsAt < now - 60 * 60_000) reminded.delete(key);
  const plan = { now: [] as string[], later: [] as Array<[string, number]> };
  if (leadMs <= 0) return plan;
  for (const meeting of meetings) {
    if (reminded.has(meeting.key) || meeting.startsAt <= now) continue;
    const delay = meeting.startsAt - leadMs - now;
    if (delay <= 0) plan.now.push(meeting.key);
    else plan.later.push([meeting.key, delay]);
  }
  return plan;
}
