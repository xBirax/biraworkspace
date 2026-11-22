export function recommendedMaxLoadedViews(totalMemBytes: number): number {
  // Cada view carregada custa ~200-700MB de renderer. Os limites antigos (12
  // em 32GB) eram altos demais para disparar: o usuário nunca chegava ao teto,
  // então o LRU nunca rodava e views ficavam residentes indefinidamente.
  // Degraus um pouco abaixo do nominal: os.totalmem() de uma máquina de 24 GB
  // dá ~23,7 GiB (memória reservada/vídeo integrado), e com `< 24` ela caía no
  // degrau de 16 GB. Mesmo critério do teto de memoryBudgetBytes.
  const gb = totalMemBytes / 1024 ** 3;
  if (gb < 11) return 3;
  if (gb < 22) return 4;
  if (gb < 44) return 6;
  return 8;
}

export type MemoryPressure = "normal" | "high" | "critical";

/** Sentinela do CRM no LRU — uma view, fora de `serviceViews`. */
export const CRM_VIEW_ID = "crm";

export type HibernateCandidate = {
  id: string;
  lastUsedAt: number;
  keepAwake: boolean;
  active: boolean;
};

/**
 * Pin "manter sempre ativo". Em pressão, pin de mídia (YouTube/Spotify) só
 * vale com áudio — senão o teto 1 nunca chega. Pin de WhatsApp continua.
 */
export function keepAwakeBlocksHibernation(opts: {
  keepAwake: boolean;
  pressure: MemoryPressure;
  audible: boolean;
  mediaService: boolean;
}): boolean {
  if (!opts.keepAwake) return false;
  if (opts.pressure === "normal") return true;
  if (opts.mediaService) return opts.audible;
  return true;
}

/** Oldest inactive safe views beyond maxLoaded. */
export function pickViewsToHibernate(
  candidates: HibernateCandidate[],
  maxLoaded: number,
  grace?: { now: number; minimumIdleMs: number },
): string[] {
  const limit = Math.max(1, maxLoaded);
  const protectedIds = new Set(candidates.filter((c) => c.active || c.keepAwake).map((c) => c.id));
  const victims = candidates
    .filter(
      (c) =>
        !protectedIds.has(c.id) &&
        (!grace || !c.lastUsedAt || grace.now - c.lastUsedAt >= grace.minimumIdleMs),
    )
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const overflow = Math.max(0, candidates.length - limit);
  if (overflow <= 0) return [];
  // Prefer hibernating unprotected first; if still over, never touch active/keepAwake.
  // Sob pressão, o teto pode cair no exato clique que troca de aba. A graça evita
  // destruir imediatamente a view que o usuário acabou de deixar; ela continua
  // elegível assim que cumprir a mesma ociosidade calculada para a pressão atual.
  return victims.slice(0, overflow).map((v) => v.id);
}

export const HIBERNATE_AFTER_MS = 10 * 60 * 1000;

/**
 * Quanto o app está pesando AGORA — não quanta RAM a máquina tem.
 *
 * `recommendedMaxLoadedViews` é um palpite fixo por tamanho de máquina, e o
 * palpite erra dos dois lados: quatro abas leves cabem folgadas onde duas abas
 * de WhatsApp com anos de histórico já apertam. Pior, ele erra para cima onde
 * dói mais — em 30 GB o teto é 8 views, e 8 renderers de app web passam de 4 GB
 * sem nunca cruzar limite nenhum. O usuário via exatamente isso: "o app está
 * comendo RAM", com o LRU parado porque o teto nunca foi atingido.
 *
 * Daí a medida real (soma do working set dos processos do app) virar entrada da
 * política. `normal` é o comportamento de sempre; `high` e `critical` apertam o
 * teto e encurtam a ociosidade — hibernar é o único jeito de devolver RAM, já
 * que renderer vivo e escondido não devolve quase nada ao sistema.
 */

/**
 * Teto de "alto" em bytes: 35% da máquina, preso entre 1,5 GB e 4 GB — ou 6 GB
 * a partir de 24 GB de RAM. O corte é 22 GiB porque `os.totalmem()` de uma
 * máquina de 24 GB mede ~23,7 GiB (memória reservada/iGPU); 20 GB mede < 20.
 *
 * A fatia sozinha não serve. Em 8 GB, 35% são 2,8 GB e é justo; em 32 GB seriam
 * 11 GB, ou seja, teto nenhum — e é justamente na máquina grande que o app
 * engorda sem incomodar ninguém até incomodar todo mundo. O piso de 1,5 GB
 * existe para a máquina pequena não entrar em pressão com o app recém-aberto (o
 * boot mede ~2 GB), o que só faria a aba da frente recarregar sem parar.
 *
 * Os 4 GB fixos eram apertados demais na máquina grande: com quatro WhatsApps
 * "sempre ativos" o app vive entre 3,9 e 4,3 GB, e o diagnóstico de 01/10 (31,6
 * GB) mostrou a pressão alternando normal/alta a cada poucos minutos — cada
 * "alta" cortando o teto de abas pela metade e o prazo para 3 min, e tirando a
 * proteção do YouTube pausado. 6 GB ainda são menos de 20% de uma máquina de 32.
 */
export function memoryBudgetBytes(totalMemBytes: number): number {
  const share = totalMemBytes * 0.35;
  const cap = totalMemBytes >= 22 * 1024 ** 3 ? 6 * 1024 ** 3 : 4 * 1024 ** 3;
  return Math.min(Math.max(share, 1.5 * 1024 ** 3), cap);
}

export function memoryPressure(appBytes: number, totalMemBytes: number): MemoryPressure {
  if (!(appBytes > 0) || !(totalMemBytes > 0)) return "normal";
  const budget = memoryBudgetBytes(totalMemBytes);
  if (appBytes >= budget * 1.4) return "critical";
  if (appBytes >= budget) return "high";
  return "normal";
}

/** Em `critical` sobram a aba da frente e as fixadas ("manter sempre ativo"). */
export function maxLoadedViewsUnderPressure(base: number, pressure: MemoryPressure): number {
  if (pressure === "critical") return 1;
  if (pressure === "high") return Math.max(1, Math.floor(base / 2));
  return Math.max(1, base);
}

/**
 * Passou ociosidade suficiente para hibernar?
 *
 * A aba da frente só é intocável ENQUANTO alguém está olhando. Com a janela
 * minimizada ou escondida ela envelhece como qualquer outra — é a única forma de
 * devolver o maior renderer do app (WhatsApp com histórico longo, ou o CRM), que
 * o LRU e a pressão de RAM sempre pouparam por ser a ativa.
 *
 * `lastUsedAt` 0 é "nunca foi aberta": não tem idade para medir, e sai só pelo
 * LRU — onde o 0 já a coloca como primeira vítima.
 */
export function shouldHibernateForIdle(opts: {
  lastUsedAt: number;
  now: number;
  idleMs: number;
  isActive: boolean;
  hidden: boolean;
}): boolean {
  if (opts.isActive && !opts.hidden) return false;
  if (!opts.lastUsedAt) return false;
  return opts.now - opts.lastUsedAt >= opts.idleMs;
}

/** Minimizado ninguém está olhando: 2 min, e nunca mais que o prazo normal. */
export const HIBERNATE_MINIMIZED_MS = 2 * 60 * 1000;

/**
 * Ociosidade exigida antes de hibernar. Encurtar sob pressão é o que faz a RAM
 * cair em minutos em vez de em dez — e quem está com o app pesado prefere pagar
 * um reload da aba que não usa há três minutos.
 */
export function hibernateAfterMs(
  pressure: MemoryPressure,
  minimized = false,
  idleMinutes = HIBERNATE_AFTER_MS / 60_000,
): number {
  const requested = idleMinutes * 60_000;
  const base = pressure === "critical"
    ? Math.min(requested, 60_000)
    : pressure === "high" ? Math.min(requested, 3 * 60_000) : requested;
  // A janela minimizada é o único sinal barato de "ninguém está usando o app".
  // Sem ele, quem minimiza para trabalhar em outra coisa segue pagando N
  // renderers residentes por dez minutos — e como só a pressão de RAM encurtava
  // o prazo, a conta só baixava depois de o app já estar pesado.
  return minimized ? Math.min(base, HIBERNATE_MINIMIZED_MS) : base;
}
