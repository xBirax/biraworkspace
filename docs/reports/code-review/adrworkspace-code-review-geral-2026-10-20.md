# ADR Workspace — code review geral (RAM, bugs, layout, dívida técnica)

Data: 2026-10-20
Base: branch `teste-0.1.53-test.4` (`36bcee7`, versão `0.1.53-test.4`)
Método: leitura do código em cinco frentes paralelas (RAM; `workspace-window.ts` 1–3500;
`workspace-window.ts` 3276–7002 + `index.ts`; demais módulos do main, preloads e `packages/*`;
shell/UI). Os achados de severidade alta e média foram conferidos de novo no código antes de
entrar aqui. Nada foi alterado no código e o app não foi executado: os itens marcados
**(plausível)** dependem de comportamento em execução e precisam de confirmação.

## Estado das verificações automáticas

| Verificação | Resultado |
|---|---|
| `pnpm typecheck` | passa |
| `pnpm lint` | passa (0 avisos) |
| `pnpm test` | passa — 746 testes (596 no desktop, 150 nos pacotes) |
| Cobertura do processo main | **40,8 % das linhas**. O script `coverage` mostra mais porque exclui `workspace-window.ts` e `index.ts` |
| `prettier --check` | 142 arquivos fora do padrão (descontado CRLF). Não roda no CI |

## Prioridades (o que fazer primeiro)

1. **Atualização instala no meio de chamada do Teams/WhatsApp** (bug alto, §2.1).
2. **Trocar de workspace carrega o CRM inteiro à toa** (RAM alto, §1.1).
3. **Teto de abas carregadas (LRU) não age** — `maxLoadedViews` e a recomendação do otimizador não têm efeito (RAM alto, §1.2).
4. **Falha no boot deixa processo zumbi com o lock** — o app "não abre mais" (§2.2).
5. **Sair da conta Google recarrega ADR Browser, Spotify e Meet** (§2.3).
6. **Prompt de senha do cofre mostra "PIN numérico"** e **Enter confirma ação destrutiva** (UI alta, §3.1 e §3.9).
7. **Sonda do Meet perdida desliga a detecção de chamada da aba para sempre** (§2.4).

## 1. Consumo de RAM

Estimativas de MB são de leitura, não medidas.

| # | Impacto | Onde | Problema | Correção mínima |
|---|---|---|---|---|
| 1.1 | Alto | `workspace-window.ts:5830-5842`, `shell/index.html:749` | `shell:set-workspace` termina em `showSurface("crm")`; o `layout()` cria e carrega o CRM (2210-2215) e só depois a lateral mostra o serviço clicado. Cada clique num serviço de outro workspace paga uma carga do app Next do CRM (o próprio código estima 400–700 MB), que fica vivo 10 min. | `set-workspace` recebe o `surface` clicado e chama `showSurface(parseSurface(surface))`; `index.html` deixa de chamar `show` em seguida; `shell-preload.cjs:35` repassa o argumento. |
| 1.2 | Alto | `hibernation.ts:241` + `view-lifecycle/src/hibernate.ts:55` | O LRU usa `minimumIdleMs: idleMs`, a mesma ociosidade do passo anterior — só escolhe abas que já teriam hibernado por ociosidade. Quem abre 8 serviços em 10 min fica com 8 renderers, com teto 4. A configuração "Serviços mantidos em memória" e a recomendação do otimizador não fazem nada. | Graça curta fixa no LRU, ex.: `Math.min(idleMs, 90_000)`; ajustar `hibernate.test.ts:126-142`. |
| 1.3 | Alto (decisão de produto) | `service-catalog.ts:366-373`, `contracts/src/index.ts:310` | `keepMessengersAwake` (ligado por padrão) mantém WhatsApp, Gmail, **Outlook e Teams** acordados até pressão crítica (1,4× o orçamento). Teams/Outlook web costumam ser os maiores renderers. | Tirar Teams e Outlook da regra, ou deixá-los ceder em pressão "high" após N min sem uso. Custo: contador deles para enquanto hibernam. |
| 1.4 | Médio | `workspace-window.ts:681` | `panel.html` (80 KB + `optimizer-panel.js`) carrega no boot e recebe todo `broadcastState`, mesmo escondido. | Carregar sob demanda no ramo de configurações do `layout`, como `ensureBrowserToolbar`; adiar o `shell:panel-tab` para o `did-finish-load`. |
| 1.5 | Médio-baixo | `workspace-window.ts:764`, `632-652`, `699-712` | `promptOverlay`, `miniBar` e `browserToolbar` nascem sob demanda mas nunca morrem (só vão para `HIDDEN`). | Ao terminar o uso: `removeChildView` + `closeView` e zerar a referência. ~25–40 MB por view. |
| 1.6 | Médio (plausível) | `view-lifecycle/src/media-active.ts:12-25` | Qualquer `[contenteditable]` com texto bloqueia hibernação: Notion, Trello e telas grandes do CRM provavelmente nunca hibernam; o motivo não é registrado. | Logar o `reason` uma vez por view; só considerar "sujo" o contenteditable que contém `document.activeElement`. |
| 1.7 | Médio-baixo | `workspace-window.ts:3873` | `nobodyWatching` ignora tela bloqueada do Windows: app maximizado + PC bloqueado no almoço não hiberna a aba da frente. | `\|\| powerMonitor.getSystemIdleState(60) === "locked"`. |
| 1.8 | Baixo | `workspace-window.ts:3382-3390` | `onCompleted` do log HTTP continua chamado em toda requisição depois da janela de 5 min. | `setTimeout(() => ses.webRequest.onCompleted(null), 5 * 60_000)`. |
| 1.9 | Baixo | `workspace-window.ts:3668`, `3317` | `console-message` registrado em todos os serviços (só Gmail/WhatsApp/composer usam); `cookies.on("changed")` do Spotify ouve toda a sessão Google compartilhada. | Registrar só nos kinds que usam. |
| 1.10 | Baixo | `ad-blocker.ts:117` | `onBeforeRequest` em toda sessão (inclusive WhatsApp/Teams/Outlook): cada requisição passa pelo thread JS do main. | Decisão: restringir às sessões com abas do Browser muda o bloqueio fora dele. |
| 1.11 | Baixo | `workspace-window.ts:690` | A barra do Browser tem partição persistente própria (`persist:adr-browser-toolbar`) sem motivo aparente. | Usar a sessão padrão. |
| 1.12 | Baixo | `shell/fonts/*.ttf` | 3 TTF (1 MB) em 7 páginas do shell. | WOFF2 com subset Latin-1 (~30 KB por peso) e `font-display: block`. |
| 1.13 | Baixo | `workspace-window.ts:3920` | `appMemoryBytes` soma `workingSetSize` (inclui páginas compartilhadas): a pressão dispara antes do pretendido — mais reloads, não mais RAM. | No Windows, `memory.privateBytes`. |

Conferido e sem problema: listeners por sessão protegidos por `WeakSet`; listeners por view morrem
com o webContents; hibernação fecha de verdade (`removeChildView` + `close` + `closeAllConnections`);
todas as coleções em memória têm teto (log 200, feed 50, downloads 50, histórico 5000, abas fechadas
10); lista do adblock carregada uma vez; worker da agenda encerrado após cada leitura; nenhum polling
nas páginas do shell; `SpareRendererForSitePerProcess` desligado.

## 2. Bugs

### Alta

**2.1 Atualização instala no meio de chamada do Teams, WhatsApp ou Meet no Browser.**
`workspace-window.ts:6889-6896`. O "ocupado" do `installUpdateWhenIdle` é só `isCurrentlyAudible()`
no instante do tick + `meet.anyCall()` (que só rastreia views `kind === "meet"`) + downloads. Numa
reunião do Teams em que a pessoa só ouve e não toca no teclado por 5 min, basta um segundo de
silêncio no tick de 60 s para `installDownloadedUpdate()` fechar o app. O comentário em 6864 promete
o contrário. Correção: carimbo `lastAudibleAt` no `audio-state-changed` (3652) exigindo 5 min sem
som, ou rodar `MEDIA_ACTIVE_PROBE` nas views vivas antes de instalar.
Observação: `docs/PROGRESSO.md` ainda diz que o update "não instala mais sozinho" por o pacote não
ser assinado; a instalação automática voltou em `bee1eba` (0.1.50). Atualizar o documento ou rever a
decisão.

### Média

| # | Onde | Cenário → resultado | Correção mínima |
|---|---|---|---|
| 2.2 | `index.ts:598` (`app.whenReady().then(async …)` sem `.catch`) | `saveAppStateAtomic` do boot (`workspace-window.ts:466`) lança com disco cheio/antivírus → nenhuma janela, processo vivo segurando o single-instance lock; cada clique no ícone cai no `second-instance`, que não acha janela. App "não abre" até matar pelo Gerenciador de Tarefas. | `.catch((e) => { console.error(e); dialog.showErrorBox(…); app.exit(1); })`. |
| 2.3 | `workspace-window.ts:5680-5688` | "Sair da conta Google" recarrega para a home toda view com `usesSharedGoogleSession` — inclui `browser`, `spotify`, `youtube`, `meet`: perde páginas do ADR Browser, para a música, derruba reunião do Meet. Sem `profileId`, recarrega de todas as contas. | Recarregar só gmail/calendar/drive/gemini (e meet fora de chamada); nos demais, só se a URL atual for de `accounts.google.com`. |
| 2.4 | `meet-integration.ts:98, 183-194` | Sonda pendente durante recarga da aba nunca resolve; `probing` fica preso → em 60 s `tracker.forget` encerra a chamada no meio (desliga não-perturbe, Ctrl+Alt+M, mini-janela; oferece "Registrar no CRM?"), a hibernação passa a ver a aba como livre e nenhuma chamada futura naquela aba é detectada. **(plausível)** — o próprio `hibernation.ts:43` documenta sonda perdida. | `WeakMap<WebContents, number>` com o início da sonda; ignorar pendência após ~60 s, como `hibernation.ts:116-128`. |
| 2.5 | `workspace-window.ts:2383-2391`, `2797-2803`, `2833-2839` | Workspace A ativo, só o B tem Meet, B ainda sem login conferido: lembrete/link do Meet ativa B, o portão vê "deslogado", mostra o toast falso e vai para o CRM; `openUrlInService` devolve false mas `openInMeetService` devolve **true** → a reunião não abre nem no app nem no navegador. Mesmo com Teams. | `openInMeetService`/`openInTeamsService` devolvem o resultado de `openUrlInService`; em `showSurface`, esperar `crmSessionHasLogin` quando `!crmLoginKnown.has(workspaceId)`. |
| 2.6 | `workspace-window.ts:2967-2972` | Qualquer página (inclusive site qualquer no ADR Browser) faz `window.open("https://app.adragencia.com.br/<rota>")` → carrega na aba do CRM com a sessão do usuário. Fura a allowlist `isCrmHandoffPath` que o WhatsApp respeita. Impacto depende de rotas GET com efeito no CRM. | Para views que não são do CRM, aplicar `isCrmHandoffPath` antes de `openCrmPath`. |
| 2.7 | `workspace-window.ts:1023-1027` | A aba do CRM libera `accounts.google.com` no `will-navigate` e não confere `did-navigate`: um OAuth com `redirect_uri` de terceiro termina com página de fora dentro da aba do CRM (sem barra de endereço). **(plausível)** | No `did-navigate` do CRM, URL final fora do CRM e dos domínios de login → `loadCrmUrl` + abrir no navegador externo. |
| 2.8 | `runtime-profile-backup.ts:30-37, 47-73` | Apagar a pasta `before-electron44-*` para liberar espaço faz o app refazer a cópia inteira do perfil a cada abertura (síncrona, GBs) e fechar se faltar disco. Se o perfil for junction/symlink (ex.: movido para D:), o `filter` recusa a própria raiz e o app fecha sempre. | Marcador `complete` vale sem a pasta; na raiz, `realpath` em vez de recusar link. |
| 2.9 | `permission-handler.ts:167-168` | No horário silencioso, a checagem de permissão devolve `false` também para a página: WhatsApp/Gmail leem `Notification.permission = "denied"` e mostram "Ativar notificações". O comentário das linhas 170-171 explica por que isso só deveria valer para service worker. | Aplicar a regra de horário só quando `!contents` (a página já é silenciada pelo guard injetado). |
| 2.10 | `bitwarden-cli.ts:126` + `password-vault-format.ts:229` | `bw list items` com código 0 devolvendo objeto (erro, versão diferente) vira `[]` → `mirrorBitwardenEntries` apaga todas as entradas vindas do Bitwarden. | Lançar `BitwardenError("failed")` se `!Array.isArray(items)`; confirmar quando vier vazio e havia entradas. |
| 2.11 | `contracts/src/index.ts:277-285` | Downgrade com valor novo de enum em `settings` (ex.: `sidebarPosition: "floating"`) reprova o estado e o `.bak` → quarentena e app vazio, todas as contas deslogadas. | `.catch(default)` nos enums e números com faixa de `settings`. |

### Baixa

- **Lusha** (`lusha.ts:236-245, 383-392`): segundo clique com o card aberto deixa a promise anterior pendurada e o Esc antigo fecha o card novo. Guardar e chamar o `dismiss` anterior antes de redesenhar.
- **Contador não zera** ao sair da conta Google, ao trocar a conta de um Gmail (`5771-5780`, o da Microsoft zera em 5745) ou ao deslogar dentro da aba (`3593-3613`). Chamar `clearServiceUnread`.
- **Atalhos roubam teclas da página**: Ctrl+K (4256) é "inserir link" no Gmail/Outlook/Notion; Ctrl+H (4213) é "substituir" no Google Docs. Aplicar a regra de `pageOwnsFindAndPrint`.
- **DevTools continua aberto** depois que o WhatsApp bloqueia (`5372-5388`, `3996-4006`): chamar `closeDevTools()`.
- **Painéis do shell sem `render-process-gone`** (`shellView`, `titlebar`, `panel`, `overlay`): se o processo cair, a janela sem moldura fica sem botões e sem lateral. Recarregar o `loadFile`.
- **PIN "corrupt" por erro passageiro** (`whatsapp-lock.ts:272-280`): EBUSY/EPERM/DPAPI vira "corrupt" e abre "Desativar bloqueio" sem PIN. Só falha de parse deve virar "corrupt"; I/O vira "unavailable". **(plausível)**
- **`setNotificationSettings` sem prazo** (`5893` → `2693-2702`): um renderer travado deixa a tela de notificações sem resposta. `Promise.race` com timeout ou `void …catch()`.
- **Menu da aba do Browser** (`4998-5008`): "Recarregar" usa o webContents capturado na abertura; se a aba hibernar com o menu aberto, "Object has been destroyed". Reler a view no clique.
- **`scheduleMeeting`** (`1829-1842`) lê `workspaceId` antes e depois de um `await` de até 5 s.
- **Laço de recarga do Gmail** em `google.com/intl/…` sem teto (`3500-3506`). **(plausível)**
- **Log "crm surface" a cada resize** (`2222-2227`): arrastar a borda enche o buffer de 200 linhas do diagnóstico.
- **Listener `once("did-finish-load")` acumulado** em retentativas da barra do Browser (`702-711`).
- **Lembrete com agenda secundária** (`calendar-reminders.ts:44-104`): o filtro anti-convite não aceito some sem aviso.
- **Lembretes atrasados** até 30 s (`calendar-scheduler.ts:185-188`): usar `now()` em `schedule`.
- **Histórico apagado** após falha transitória de decrypt (`browser-history.ts:237-241`): o `flush` seguinte grava vazio por cima.
- **Bitwarden**: timeout no `unlock` aparece como "senha mestra incorreta" (`bitwarden-cli.ts:113-116`).
- **Cofre**: URL `com.br` no CSV/Bitwarden casa com qualquer `*.com.br` (`password-vault-format.ts:66-67, 133-137`).
- **Downloads**: `.svg` abre por padrão; `.html/.htm/.mht` fora da lista de arriscados (`download-policy.ts:38-42`).
- **Autoplay sem gesto para qualquer site** (`index.ts:99`): o comentário supõe só serviços escolhidos, mas o ADR Browser abre qualquer site.
- **`restoreWorkspace`** ressuscitaria serviços excluídos antes (`workspaces/src/index.ts:179, 204-208`) — sem chamador hoje.

## 3. Layout e UI

| # | Prioridade | Onde | Problema | Correção mínima |
|---|---|---|---|---|
| 3.1 | Alta | `workspace-window.ts:6232`, `shell/prompt.html:129-153` | Salvar credencial no cofre pede a senha com texto "Digite o PIN numérico (4 a 12 dígitos)", rótulo "PIN", teclado numérico e placeholder "••••". A senha mestra do Bitwarden também ganha o teclado numérico. | Passar hint/label em 6232; `numeric` só quando `askPin` pedir. |
| 3.2 | Alta (plausível) | `workspace-window.ts:783-798`, `4664`, `4670`, `4623` | `showPrompt` não chama `promptOverlay.webContents.focus()`: o PIN digitado tende a ir para a view de baixo até clicar. Fechar paleta, notificações ou prompt não devolve o foco (`focusActiveSurface`). | Focar o prompt no `did-finish-load`; chamar `focusActiveSurface()` nos três fechamentos. |
| 3.3 | Alta (conferir na tela) | `shell/index.html:152-162, 195, 105, 135, 424` | Lateral "Em cima"/"Embaixo" com a barra expandida (padrão): `#tab-ws-add`, `.util`, `.ws`, `.rail-sep` ficam com `width:100%` e empurram os serviços para fora. | `body:is([data-position="top"],[data-position="bottom"])[data-expanded="true"] :is(#tab-ws-add,#tab-add,.util,.ws,.rail-sep){width:auto}`. |
| 3.4 | Alta | `tokens.css:26-40`, `panel.html:652-657`, `browser-toolbar.html:171` | Contraste no tema claro: `--accent-soft` 3,8:1, mensagem de sucesso ~2,3:1, `--warn` ~2,8:1, escudo "permitido" ~1,9:1. No escuro, `--danger` ~3,8:1 em texto de erro. | Claro: `--accent-soft:#047857; --warn:#b45309`. Escuro: token `--danger-fg:#f87171` para texto. |
| 3.5 | Média | `workspace-window.ts:1740-1748` | Toast em x=0 no canto inferior esquerdo cobre por 3,4 s os botões da lateral ou o voltar/avançar do Browser; o clique fecha o toast. | Posicionar pelo `main` do último layout. |
| 3.6 | Média | `workspace-window.ts:553-561`, `2266`, `2279` | Janela sem tamanho mínimo; `Math.max(main.height - toolbarPx, 200)` faz a página invadir barra/titlebar em janela baixa ou escala 200 %. | `minWidth: 640, minHeight: 480`; piso 0 no cálculo. |
| 3.7 | Média | `workspace-window.ts:559, 605, 619, 679`, `theme.js` | Flash escuro no tema claro: fundos das views fixos em escuro e o tema só aplicado quando o estado chega. | `nativeTheme.shouldUseDarkColors` nos `setBackgroundColor`; aplicar o tema já no fim de `theme.js`. |
| 3.8 | Média | `index.html:842`, `panel.html:1439` | "Tamanho da interface" só vale no rail, painel e serviços; titlebar, barra do Browser, paleta, notificações, toast e prompt ficam em 100 %. | `style.zoom` em `overlay.html`/`prompt.html`; multiplicar `TITLEBAR_PX`/`BROWSER_TOOLBAR_PX` por `uiScale`. |
| 3.9 | Média | `workspace-window.ts:4613-4615` | `shell:confirm` com `defaultId: 1`: Enter executa "Remover", "Sair", "Revogar". Ordem dos botões varia entre diálogos; há botões "OK". | `defaultId: 0` e uma ordem única `[Cancelar, ação]`. |
| 3.10 | Média | `panel.html:1261-1355`, `tokens.css:179` | Aba Privacidade com `cssText` inline (borda invisível no escuro, padding 6 px contra 38 px nas outras); `.btn.secondary` não existe; `.btn.danger` só tem hover. | Remover o inline; `.btn.danger { color: var(--danger) }`. |
| 3.11 | Média | `overlay.html:50, 359-367` | Paleta: com ↓ a seleção passa do 7º item sem rolar; hover e `.active` destacam duas linhas. | `scrollIntoView({ block: "nearest" })`. |
| 3.12 | Média | `index.html:302-310` | Véu do serviço hibernado cobre só parte do ícone. | `.slot.hibernated :is(.tile,img){opacity:.45}`. |

Baixa: textos longos sem `min-width:0`/ellipsis em notificações, toast e status do serviço; quatro
estilos de anel de foco diferentes (e cortado nos botões da titlebar); toggles sem `<label>`; horas do
Não perturbe sem rótulo; abas do Browser sem ←/→; badge do rail como tab stop extra; "Maximizar" não
vira "Restaurar"; prompt cobre a titlebar (`y: TITLEBAR_PX`); `scroll-behavior: smooth` ao trocar de
aba do painel; microcopy ("Badge … na bandeja", "em mute", "hard Ctrl+Shift+R", "1 itens",
"reunião(ões)", "credencial(is)", "Renomear aplicativo" × "Renomear serviço", "Limite de abas em
memória" × "Serviços mantidos em memória", `svc.kind` cru na paleta, "Falha"/"Ok" genéricos); CSS
morto ou duplicado (`--shadow`, `--normal`, `::-webkit-scrollbar` ignorado, `<style>` de `prompt.html`
e da `browser-toolbar.html` quase todo sobrescrito por `internal-surfaces.css`, blocos repetidos em
`panel.css` 943-967/1036-1043); cores fixas (`#d39345`, três véus rgba diferentes, mini-bar só escura
e em Segoe UI); pesos 600/650 caem no Bold — padronizar 400/500/700.

## 4. Dívida técnica

| Item | Situação | Sugestão |
|---|---|---|
| `workspace-window.ts` | **7.002 linhas**, quase tudo numa closure só (`createWorkspaceWindow`). Era 2.749 em 03/ago e 4.624 em 06/out: +4.250 linhas em 2,5 meses. `PROGRESSO.md` ainda fala em "~2.900". Concentra layout, 82 handlers IPC, views, CRM, cofre, Bitwarden, adblock, downloads, update, atalhos. | Continuar o padrão que já funciona (`permission-policy`, `notifications`, `hibernation`, `meet-integration` são puros e testados): extrair um módulo por commit, começando pelos que mais mudam — cofre/Bitwarden (6108-6540), abas do Browser (4884-5120), trava do WhatsApp (371-490 e 5348-5620), atalhos (4116-4380), IPC da toolbar (6445-6640). |
| Cobertura | 40,8 % das linhas do main. `workspace-window.ts` e `index.ts` (~7.700 linhas): 0 %. Também 0 %: `downloads.ts`, `diagnostics.ts`, `screen-share.ts`, `updates.ts`. | Tirar a exclusão do script `coverage` para o número ser honesto; cada extração do item acima traz seu teste. |
| Testes que leem código como texto | `index.test.ts` (20 asserções) e `workspace-runtime.test.ts` (6) fazem `readFileSync` de `.ts/.cjs/.html` e `toContain`. Quebram com refatoração inofensiva e não pegam bug de comportamento. | Substituir conforme os trechos forem extraídos. |
| Promessas sem tratamento | 72 `void` só em `workspace-window.ts` e 37 `catch` vazios no main; o `unhandledRejection` global só registra no log (é por isso que §2.2 vira processo zumbi). | Tratar no boot e nos fluxos que mudam estado; manter o `void` só em `loadURL` de navegação. |
| Pacotes mortos | `@adr/crm-whatsapp-ui` é placeholder de 2 linhas ("moves here in refinements 8–9"). `@adr/crm-chrome-adapter` gera uma extensão que o app não usa (o CRX vem do vendor, de outro repositório) e roda no `pnpm build`. | Remover `crm-whatsapp-ui`; decidir se `crm-chrome-adapter` ainda tem função. |
| Scripts `verify-refinement-*` | 17 scripts; 13 chamam `~/.local/bin/pnpm` (caminho de Linux) — não rodam no Windows. Só 3 estão no `package.json`. | Apagar; o CI já roda typecheck/lint/test. |
| `vendor/` | 8 versões da extensão do CRM (0.12.5 → 0.15.5, ~1,3 MB) e o `extraResources` copia a pasta inteira para o instalador; só a mais nova é carregada (`extension-inject.ts:80-83`). | Manter só a versão atual no repositório e no pacote. |
| Formatação | 142 arquivos fora do Prettier (descontado CRLF); `format:check` não roda no CI. | Um commit só de `prettier --write` + `format:check` no CI. |
| Documentação | `PROGRESSO.md` contradiz o código em dois pontos: tamanho do `workspace-window.ts` e instalação automática do update (§2.1). README lista `vendor/adr-crm-extension-0.15.3`, mas a atual é 0.15.5. | Atualizar junto com os lotes de correção. |
| Pontos saudáveis | Typecheck estrito, lint limpo, zero `@ts-ignore`/`eslint-disable`, 1 `any` fora de teste, escrita atômica com fsync no estado e nos cofres, IPC validando sender e frame, comentários explicando o porquê. | — |

## 5. Plano sugerido em lotes

Todos os lotes mexem em `workspace-window.ts`, então rodam um de cada vez.

1. **Lote 1 — bugs que afetam o uso diário:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.9, 2.10, 3.1, 3.9.
2. **Lote 2 — RAM:** 1.1, 1.2, 1.4, 1.5, 1.7, 1.8, 1.9 (1.3 e 1.10 dependem de decisão).
3. **Lote 3 — UI:** 3.2–3.8, 3.10–3.12 e a lista de baixa prioridade.
4. **Lote 4 — segurança/robustez:** 2.6, 2.7, 2.8, 2.11 e os itens baixos do cofre, downloads e PIN.
5. **Lote 5 — dívida:** limpeza (pacotes mortos, scripts, vendor, Prettier, docs) e início da
   extração do `workspace-window.ts` com testes.

## Limitações

O app não foi executado nem medido (`getAppMetrics`); contrastes calculados pela fórmula da WCAG;
os itens **(plausível)** dependem de comportamento do Electron 44/NSIS em execução. Não foram revistos
a fundo `crm-chrome-adapter`, `crm-whatsapp-ui`, `optimizer/metrics.ts` nem o helper Rust
`optimizer-native`.
