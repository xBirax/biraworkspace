/**
 * Peças puras dos recursos de navegador do Bira Browser (buscar na página,
 * imprimir, reabrir aba fechada, ícone do site, corretor). Ficam fora de
 * workspace-window.ts para dar para testar sem abrir janela.
 */

/**
 * Sites que tratam Ctrl+F/Ctrl+P por conta própria. O before-input-event chega
 * ANTES da página: interceptar ali tirava do Docs/Planilhas a busca e a
 * impressão deles (que geram o PDF certo) e imprimia o editor cru.
 */
export function pageOwnsFindAndPrint(url: string): boolean {
  try {
    return new URL(url).hostname === "docs.google.com";
  } catch {
    return false;
  }
}

/**
 * Primeiro ícone http(s) que a página anunciou. `data:`/`blob:` e outros
 * esquemas ficam de fora: a barra é página do app e só exibe endereço web.
 */
export function pickFavicon(favicons: readonly string[]): string | null {
  for (const raw of favicons) {
    if (raw.length > 2048) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      // ícone com endereço inválido: tenta o próximo
    }
  }
  return null;
}

/** Os mesmos degraus do zoom do Chrome. */
export const PAGE_ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
] as const;

/**
 * Próximo degrau de zoom (Ctrl+= / Ctrl+-, Ctrl+roda). De um valor fora da
 * lista vai para o degrau seguinte naquela direção; nas pontas fica parado.
 */
export function nextZoomLevel(current: number, direction: 1 | -1): number {
  if (direction > 0)
    return PAGE_ZOOM_LEVELS.find((level) => level > current + 0.001) ?? PAGE_ZOOM_LEVELS.at(-1)!;
  return (
    [...PAGE_ZOOM_LEVELS].reverse().find((level) => level < current - 0.001) ?? PAGE_ZOOM_LEVELS[0]
  );
}

/**
 * Ctrl+Enter na barra: "exemplo" vira "www.exemplo.com", como no Chrome. Só
 * palavra solta; o que já parece endereço ou busca segue como foi digitado.
 */
export function completeWithWww(input: string): string {
  const text = input.trim();
  if (!/^[\p{L}\p{N}-]+$/u.test(text)) return input;
  return `www.${text}.com`;
}

/**
 * Corta em CARACTERES, não em unidades UTF-16: `slice` no meio de um emoji
 * deixava meio par substituto, e o `encodeURIComponent` lançava URIError
 * dentro do clique do menu, no processo main.
 */
export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/** Busca do menu "Pesquisar no Google por…". */
export function googleSearchUrl(text: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(truncateChars(text.trim(), 500))}`;
}

/** Seleção mais longa que isto não vira termo de busca (é um parágrafo). */
export const FIND_SEED_MAX_CHARS = 120;

/**
 * Mundo isolado da leitura da seleção no Ctrl+F. Ao lado dos outros mundos do
 * app (CRM_WORLD_ID 1030, LUSHA_WORLD_ID 1031) para não colidir com eles.
 */
export const FIND_SELECTION_WORLD_ID = 1032;

/**
 * Texto selecionado que vira o termo da busca ao abrir o Ctrl+F: uma linha,
 * sem espaços sobrando. Seleção longa demais (um parágrafo) não serve de busca.
 */
export function findSeedFromSelection(selection: string): string {
  const text = selection.replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= FIND_SEED_MAX_CHARS ? text : "";
}

/**
 * Inglês primeiro, português POR ÚLTIMO — só os que a sessão realmente tem.
 * Lista vazia significa "não mexer" (fica o padrão do sistema).
 *
 * A ordem importa no corretor do Windows: medido em 15/10, as sugestões vêm do
 * último idioma da lista que tiver alguma. Com [pt-BR, en-US], "excessão"
 * sugeria só "excess" (e o clique trocava pela palavra inglesa); com
 * [en-US, pt-BR] sugere "exceção"/"excesso", e "wrongg" continua com "wrong".
 */
export function pickSpellCheckerLanguages(available: readonly string[]): string[] {
  const wanted = [
    ["en-US", "en"],
    ["pt-BR", "pt"],
  ];
  const picked: string[] = [];
  for (const options of wanted) {
    const hit = options.find((code) => available.includes(code));
    if (hit) picked.push(hit);
  }
  return picked;
}

export type ClosedBrowserTab = {
  serviceId: string;
  workspaceId: string;
  /** Posição na barra lateral quando foi fechada. */
  index: number;
  url: string;
};

/** Pilha do Ctrl+Shift+T: a última aba fechada volta primeiro. */
export class ClosedTabStack {
  private readonly tabs: ClosedBrowserTab[] = [];

  constructor(private readonly limit = 10) {}

  push(tab: ClosedBrowserTab): void {
    // A mesma aba não entra duas vezes (fechou, reabriu, fechou de novo).
    const existing = this.tabs.findIndex((item) => item.serviceId === tab.serviceId);
    if (existing >= 0) this.tabs.splice(existing, 1);
    this.tabs.push(tab);
    if (this.tabs.length > this.limit) this.tabs.shift();
  }

  /**
   * A mais recente deste workspace que ainda dá para restaurar. As que não dão
   * mais (apagadas de vez, workspace removido) saem da pilha no caminho.
   */
  popFor(
    workspaceId: string,
    restorable: (serviceId: string) => boolean,
  ): ClosedBrowserTab | undefined {
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      const tab = this.tabs[i]!;
      if (tab.workspaceId !== workspaceId) continue;
      this.tabs.splice(i, 1);
      if (restorable(tab.serviceId)) return tab;
    }
    return undefined;
  }

  /** Há aba deste workspace para o "Reabrir aba fechada" do menu? */
  hasFor(workspaceId: string): boolean {
    return this.tabs.some((tab) => tab.workspaceId === workspaceId);
  }

  get size(): number {
    return this.tabs.length;
  }
}
