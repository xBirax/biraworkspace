/**
 * Botões que o app injeta no cabeçalho da conversa do WhatsApp.
 *
 * Injetados pelo app, não pelo CRX: a extensão vem de outro repositório e mexer
 * no painel exigiria esperar um release dela. Nome e telefone saem da mesma
 * sonda que o painel já usa para identificar a conversa.
 *
 * Mora fora de `workspace-window.ts` porque é JS que só existe como STRING: o
 * `tsc` não olha dentro dele, e o `try/catch` da injeção só loga — um erro de
 * sintaxe aqui faz os botões sumirem calados. Módulo separado (sem `electron`)
 * é o que permite ao teste dar `new Function(...)` e falhar no CI em vez de na
 * tela de alguém.
 */
/**
 * Mundo JS isolado da ponte `adrCrm` (crm-preload.cjs), do painel e do botão do
 * cabeçalho. A página do WhatsApp não enxerga nada daqui.
 */
export const CRM_WORLD_ID = 1030;

const CRM_HANDOFF_PARAMS = new Set([
  "vincularTelefone",
  "vincularNome",
  "vincularEmpresaNome",
  "vincularEmpresaContatoNome",
  "vincularEmpresaTelefone",
  "vincularEmpresaContatoId",
]);

/**
 * `adrCrm.openCrm({path})` é chamável por qualquer script da página do
 * WhatsApp, que é conteúdo de terceiro. Só os handoffs que os botões acima e o
 * `buildCreateCompanyPath` da extensão montam passam: `/negocios` com
 * parâmetros `vincular*`. O resto do CRM não é destino para a página escolher.
 */
export function isCrmHandoffPath(path: string): boolean {
  const base = "https://crm.invalid";
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return false;
  }
  if (url.origin !== base || url.pathname !== "/negocios" || url.hash) return false;
  return [...url.searchParams.keys()].every((key) => CRM_HANDOFF_PARAMS.has(key));
}

/**
 * Destinos que uma página de serviço (WhatsApp, Gmail, site no ADR Browser) pode
 * abrir na aba do CRM por `window.open`: as telas de pessoa, empresa e negócio que
 * o painel da extensão linka. `/api`, `/admin`, sair etc. não vêm de fora.
 */
export function isCrmPagePath(url: string): boolean {
  try {
    return /^\/(contatos|empresas|negocios)(\/[^/]+)?\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export const SAVE_CONTACT_BUTTON = `(() => {
    if (window.__adrSaveContact) return "already";
    if (!window.adrCrm) return "sem-ponte";
    window.__adrSaveContact = true;
    const LABEL = "Salvar no Google";
    const LABEL_VINCULAR = "Vincular a negócio";
    const LABEL_EMPRESA = "Vincular a empresa";
    const LABEL_AGENDAR = "Agendar reunião";
    const BTN_CSS = "margin-right:8px;font-size:11px;padding:4px 8px";
    async function chatAtual() {
      const identity = await window.adrCrm.getChatIdentity();
      return (identity && identity.data && identity.data.chat) || null;
    }
    // Cabeçalho com quatro botões quebrava a linha: "Salvar no Google" fica à
    // vista e o resto vai para "Mais ▾" (menu dentro do próprio cabeçalho).
    const ITEM_CSS = "display:block;width:100%;text-align:left;font-size:12px;padding:6px 8px";
    function maisAcoes(head, fechar) {
      const existente = head.querySelector(".adr-more-list");
      if (existente) return existente;
      const wrap = document.createElement("span");
      wrap.className = "adr-more";
      wrap.style.cssText = "position:relative;display:inline-block;margin-right:8px";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "crmwa-btn adr-more-toggle";
      toggle.textContent = "Mais ▾";
      toggle.title = "Mais ações desta conversa";
      toggle.style.cssText = "font-size:11px;padding:4px 8px";
      toggle.setAttribute("aria-haspopup", "menu");
      toggle.setAttribute("aria-expanded", "false");
      const list = document.createElement("div");
      list.className = "adr-more-list";
      list.setAttribute("role", "menu");
      list.style.cssText =
        "display:none;position:absolute;right:0;top:100%;z-index:1000;flex-direction:column;gap:2px;" +
        "padding:6px;min-width:180px;background:#111b21;border:1px solid #2a3942;border-radius:8px;" +
        "box-shadow:0 6px 18px rgba(0,0,0,.35)";
      const abrir = (open) => {
        // O painel do CRM corta o que passa da borda (overflow:hidden): aberto, o
        // menu fica preso à janela, logo abaixo do botão, e não some cortado.
        if (open && typeof toggle.getBoundingClientRect === "function") {
          const r = toggle.getBoundingClientRect();
          list.style.position = "fixed";
          list.style.top = r.bottom + 4 + "px";
          list.style.right = Math.max(4, window.innerWidth - r.right) + "px";
        }
        list.style.display = open ? "flex" : "none";
        toggle.setAttribute("aria-expanded", String(open));
      };
      toggle.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        abrir(list.style.display === "none");
      });
      // Escolheu um item: fecha logo depois (dá para ver o "Abrindo…"); Esc fecha
      // e devolve o foco ao botão.
      list.addEventListener("click", (event) => {
        if (event.isTrusted && event.target !== list) setTimeout(() => abrir(false), 1200);
      });
      wrap.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || list.style.display === "none") return;
        event.stopPropagation();
        abrir(false);
        toggle.focus();
      });
      // Um ouvinte só para fechar ao clicar fora, mesmo com o painel recriado.
      if (!window.__adrMoreOutside) {
        window.__adrMoreOutside = true;
        document.addEventListener(
          "click",
          (event) => {
            for (const aberto of document.querySelectorAll(".adr-more")) {
              if (!aberto.contains(event.target)) {
                const lista = aberto.querySelector(".adr-more-list");
                const botao = aberto.querySelector(".adr-more-toggle");
                if (lista) lista.style.display = "none";
                if (botao) botao.setAttribute("aria-expanded", "false");
              }
            }
          },
          true,
        );
      }
      wrap.append(toggle, list);
      head.insertBefore(wrap, fechar);
      return list;
    }
    function itemDeMenu(btn) {
      btn.style.cssText = ITEM_CSS;
      btn.setAttribute("role", "menuitem");
      return btn;
    }
    function ensure() {
      const head = document.querySelector(".crmwa-panel-head");
      if (!head) return;
      const fechar = head.querySelector(".crmwa-x");
      if (!head.querySelector(".adr-save-contact")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "crmwa-btn adr-save-contact";
        btn.textContent = LABEL;
        btn.title = "Salva nome e telefone desta conversa no Google Contacts";
        btn.style.cssText = "margin-left:auto;" + BTN_CSS;
        // isTrusted em todos (salvar, CRM, agendar, "Mais"): a página do WhatsApp alcança estes botões no DOM, e um
        // .click() dela não pode salvar contato nem abrir o CRM.
        btn.addEventListener("click", async (event) => {
          if (!event.isTrusted) return;
          btn.disabled = true;
          btn.textContent = "Salvando…";
          try {
            const chat = await chatAtual();
            const res = await window.adrCrm.saveGoogleContact({
              name: chat && chat.name,
              phone: chat && chat.phone,
            });
            btn.textContent = res && res.ok ? "Salvo ✓" : "Falhou";
          } catch (_) {
            btn.textContent = "Falhou";
          }
          setTimeout(() => {
            btn.textContent = LABEL;
            btn.disabled = false;
          }, 2500);
        });
        head.insertBefore(btn, fechar);
      }
      // "Vincular a negócio": o painel só oferece CRIAR negócio, e a pessoa nova
      // de um cliente que já tem negócio aberto não tem para onde ir. Quem escolhe
      // o negócio é a tela do CRM — aqui só vai o telefone e o nome da conversa.
      if (!head.querySelector(".adr-link-deal")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "crmwa-btn adr-link-deal";
        btn.textContent = LABEL_VINCULAR;
        btn.title = "Abre o CRM para vincular esta pessoa a um negócio já aberto";
        btn.style.cssText = BTN_CSS;
        btn.addEventListener("click", async (event) => {
          if (!event.isTrusted) return;
          btn.disabled = true;
          try {
            const chat = await chatAtual();
            const telefone = (chat && chat.phone) || "";
            if (!telefone) {
              btn.textContent = "Sem telefone";
            } else {
              const nome = (chat && chat.name) || "";
              await window.adrCrm.openCrm({
                path:
                  "/negocios?vincularTelefone=" +
                  encodeURIComponent(telefone) +
                  (nome ? "&vincularNome=" + encodeURIComponent(nome) : ""),
              });
            }
          } catch (_) {
            btn.textContent = "Falhou";
          }
          setTimeout(() => {
            btn.textContent = LABEL_VINCULAR;
            btn.disabled = false;
          }, 2500);
        });
        maisAcoes(head, fechar).appendChild(itemDeMenu(btn));
      }
      // "Agendar reunião": abre o evento do Google Calendar já preenchido com a
      // conversa e com sala do Meet. Quem revisa, escolhe o horário e salva é a
      // pessoa, no próprio Calendar.
      if (window.adrCrm.scheduleMeeting && !head.querySelector(".adr-schedule-meeting")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "crmwa-btn adr-schedule-meeting";
        btn.textContent = LABEL_AGENDAR;
        btn.title = "Abre o Google Calendar com um evento e sala do Meet para esta conversa";
        btn.style.cssText = BTN_CSS;
        btn.addEventListener("click", async (event) => {
          if (!event.isTrusted) return;
          btn.disabled = true;
          try {
            const chat = await chatAtual();
            const res = await window.adrCrm.scheduleMeeting({
              name: chat && chat.name,
              phone: chat && chat.phone,
            });
            btn.textContent = res && res.ok ? "Abrindo agenda…" : "Falhou";
          } catch (_) {
            btn.textContent = "Falhou";
          }
          setTimeout(() => {
            btn.textContent = LABEL_AGENDAR;
            btn.disabled = false;
          }, 2500);
        });
        maisAcoes(head, fechar).appendChild(itemDeMenu(btn));
      }
      if (!head.querySelector(".adr-link-company")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "crmwa-btn adr-link-company";
        btn.textContent = LABEL_EMPRESA;
        btn.title = "Abre o CRM para criar uma empresa e vincular esta conversa";
        btn.style.cssText = BTN_CSS;
        btn.addEventListener("click", async (event) => {
          if (!event.isTrusted) return;
          btn.disabled = true;
          try {
            const chat = await chatAtual();
            const telefone = (chat && chat.phone) || "";
            const nome = (chat && chat.name) || "";
            if (!telefone && !nome) {
              btn.textContent = "Sem dados";
            } else {
              // Mesma montagem do "+ Criar empresa" do painel: content.js expõe
              // buildCreateCompanyPath, que separa "Pessoa | Empresa" e manda os
              // quatro campos. Montar à mão aqui dava dois resultados diferentes
              // para a MESMA tela do CRM — o painel pré-preenchia a empresa e o
              // cabeçalho mandava o título inteiro no campo de pessoa.
              // Sem o painel (kill switch desligado) content.js não é injetado:
              // aí vai só o telefone, que é o dado que identifica a conversa.
              const montar = window.__adrCrmCreateCompanyPath;
              await window.adrCrm.openCrm({
                path: montar
                  ? montar(telefone, null, nome)
                  : "/negocios?" +
                    new URLSearchParams(
                      telefone ? { vincularEmpresaTelefone: telefone } : {},
                    ).toString(),
              });
            }
          } catch (_) {
            btn.textContent = "Falhou";
          }
          setTimeout(() => {
            btn.textContent = LABEL_EMPRESA;
            btn.disabled = false;
          }, 2500);
        });
        maisAcoes(head, fechar).appendChild(itemDeMenu(btn));
      }
    }
    ensure();
    // Intervalo, não MutationObserver: o DOM do WhatsApp muda o tempo todo e um
    // observer de subtree rodaria centenas de vezes por minuto para reinserir um
    // botão que só some quando o painel é fechado e reaberto.
    setInterval(ensure, 2000);
    return "ok";
})()`;
