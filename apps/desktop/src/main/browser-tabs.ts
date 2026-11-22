/**
 * Faixa de abas do ADR Browser. Cada aba é um serviço de kind "browser" do
 * workspace — a mesma lista da barra lateral, na mesma ordem. A faixa não tem
 * estado próprio: criar, fechar e reordenar passam pelas mesmas funções do
 * catálogo que a lateral usa, e a faixa só redesenha o que o main manda.
 *
 * Peças puras aqui para dar para testar sem abrir janela.
 */

import type { AppStateV1 } from "@adr/contracts";

/**
 * Apaga de vez as abas do ADR Browser fechadas (soft-delete) — no início do
 * app, quando o Ctrl+Shift+T (só em memória) já não as alcança. Cada aba é um
 * serviço gravado no state; sem isto toda aba aberta e fechada ficava lá para
 * sempre. Aba de workspace excluído fica: restaurar o workspace a traz de volta.
 * As abas dividem a partição do workspace, então não sobra pasta de sessão.
 * Devolve o mesmo objeto quando não há o que apagar.
 */
export function purgeClosedBrowserTabs(state: AppStateV1): AppStateV1 {
  const liveWorkspaces = new Set(state.workspaces.filter((w) => !w.deletedAt).map((w) => w.id));
  const services = state.services.filter(
    (s) => !(s.kind === "browser" && s.deletedAt && liveWorkspaces.has(s.workspaceId)),
  );
  return services.length === state.services.length ? state : { ...state, services };
}

export type BrowserTabInfo = {
  id: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  active: boolean;
  /** Endereço da página, para a dica da aba. */
  url: string;
  /** Tocando som agora (ícone de alto-falante na aba). */
  audible: boolean;
  muted: boolean;
};

/**
 * Nova ordem das abas com `movingId` logo depois de `afterId` — onde o Chrome
 * põe a aba aberta por link, duplicada ou "nova aba à direita". Sem uma das
 * duas na lista, a ordem fica como estava.
 */
export function moveTabAfter(ids: readonly string[], movingId: string, afterId: string): string[] {
  if (movingId === afterId || !ids.includes(movingId) || !ids.includes(afterId)) return [...ids];
  const order = ids.filter((id) => id !== movingId);
  order.splice(order.indexOf(afterId) + 1, 0, movingId);
  return order;
}

/** "Fechar abas à direita": as que vêm depois de `id` na faixa. */
export function tabsToTheRight(ids: readonly string[], id: string): string[] {
  const index = ids.indexOf(id);
  return index < 0 ? [] : ids.slice(index + 1);
}

/**
 * O que a aba mostra: o título da página; sem ele (página carregando, sem
 * <title>), o domínio; sem página (aba hibernada), o nome do serviço.
 */
export function tabTitle(pageTitle: string, url: string, fallback: string): string {
  const title = pageTitle.trim();
  // O Chromium usa a própria URL como título enquanto a página não anuncia um.
  if (title && title !== url) return title.slice(0, 200);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.hostname.replace(/^www\./, "") || fallback;
    }
  } catch {
    // sem URL válida: fica o nome do serviço
  }
  return fallback;
}

/** Ctrl+Tab / Ctrl+Shift+Tab: a próxima (ou a anterior), dando a volta. */
export function cycleTab(
  ids: readonly string[],
  currentId: string,
  step: 1 | -1,
): string | undefined {
  if (!ids.length) return undefined;
  const index = ids.indexOf(currentId);
  if (index < 0) return ids[step > 0 ? 0 : ids.length - 1];
  return ids[(index + step + ids.length) % ids.length];
}

/**
 * Quem fica ativa ao fechar `closingId`: a da direita, como no Chrome; se era
 * a última, a da esquerda. Nenhuma se era a única.
 */
export function tabAfterClose(ids: readonly string[], closingId: string): string | undefined {
  const index = ids.indexOf(closingId);
  if (index < 0) return undefined;
  return ids[index + 1] ?? ids[index - 1];
}

/**
 * Leva a nova ordem das abas para a ordem completa da barra lateral. As abas
 * só trocam de lugar entre si: cada posição que era de uma aba recebe a
 * próxima aba da nova ordem, e os outros serviços (e o CRM) não se mexem.
 *
 * `null` quando a nova ordem não é exatamente as abas que estão na lateral —
 * a faixa estava desatualizada (aba fechada no meio do arrasto), e aplicar
 * metade da ordem embaralharia a lateral.
 */
export function mergeTabOrderIntoRail(
  rail: readonly string[],
  tabIds: readonly string[],
  newTabOrder: readonly string[],
): string[] | null {
  const tabs = new Set(tabIds);
  const inRail = rail.filter((id) => tabs.has(id));
  if (newTabOrder.length !== inRail.length || new Set(newTabOrder).size !== newTabOrder.length) {
    return null;
  }
  if (!newTabOrder.every((id) => tabs.has(id) && rail.includes(id))) return null;
  let next = 0;
  return rail.map((id) => (tabs.has(id) ? newTabOrder[next++]! : id));
}

/**
 * Barra lateral com UM ícone do ADR Browser, não um por aba: as abas ficam na
 * faixa de abas. O ícone é `representativeId` (a aba ativa ou a última usada)
 * e fica onde estava a primeira aba. Os outros serviços não se mexem.
 */
export function collapseRailBrowserTabs(
  rail: readonly string[],
  tabIds: readonly string[],
  representativeId: string | undefined,
): string[] {
  const tabs = new Set(tabIds);
  if (!representativeId || !tabs.has(representativeId)) return [...rail];
  const out: string[] = [];
  let placed = false;
  for (const id of rail) {
    if (!tabs.has(id)) out.push(id);
    else if (!placed) {
      out.push(representativeId);
      placed = true;
    }
  }
  return out;
}

/** O mesmo agrupamento para a lista de serviços (Ctrl+1…9, painel). */
export function collapseBrowserServices<T extends { id: string }>(
  services: readonly T[],
  tabIds: readonly string[],
  representativeId: string | undefined,
): T[] {
  const tabs = new Set(tabIds);
  const representative = services.find((s) => s.id === representativeId);
  if (!representative || !tabs.has(representative.id)) return [...services];
  const out: T[] = [];
  let placed = false;
  for (const service of services) {
    if (!tabs.has(service.id)) out.push(service);
    else if (!placed) {
      out.push(representative);
      placed = true;
    }
  }
  return out;
}

/**
 * Ordem arrastada na lateral (agrupada) de volta para a ordem completa: o
 * ícone do ADR Browser vira todas as abas, na ordem em que estão na faixa.
 * Sem o ícone na ordem recebida, as abas vão para o fim.
 */
export function expandRailBrowserTabs(
  order: readonly string[],
  tabIdsInOrder: readonly string[],
  representativeId: string | undefined,
): string[] {
  const tabs = new Set(tabIdsInOrder);
  const out: string[] = [];
  let placed = false;
  for (const id of order) {
    if (id === representativeId && !placed) {
      out.push(...tabIdsInOrder);
      placed = true;
    } else if (!tabs.has(id)) out.push(id);
  }
  if (!placed) out.push(...tabIdsInOrder);
  return out;
}
