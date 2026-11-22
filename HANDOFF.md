# Handoff — code review geral e otimização de RAM (sessão de 20/10/2026)

Documento para continuar o trabalho em outra ferramenta (ChatGPT Codex). Leia tudo antes de mexer.

**Estado final (20/10/2026, 14h20):** plano da seção 13 concluído, tudo commitado e enviado
para `origin/main`, versão **0.1.53** com notas em `docs/release-notes-0.1.53.md` e tag
`v0.1.53` **publicada como estável** em `ADRAGENCIACRM/adrworkspace-releases` (17h27 UTC,
`latest.yml` com `version: 0.1.53`). O smoke foi confirmado pelo usuário com validação parcial:
ficaram fora instalação limpa, Central de Desempenho, Trello/ChatGPT/Claude/Gemini e logout
Google (`docs/windows-release-smoke.md`). As
seções abaixo preservam a sequência dos testes; a 13 tem o registro da validação real.

## 1. Regras do dono do projeto (obrigatórias)

- **Idioma:** toda mensagem ao usuário em **português do Brasil**: respostas, commits e
  documentos. Nomes de código e comandos podem ficar em inglês.
- **Disco:** todo arquivo de trabalho fica na unidade **D:** (`D:\Claude\...`), nunca na C:.
  Instalações também em D: quando possível.
- **Testes do app:** com a janela do ADR Workspace **minimizada** ou fora da tela, sem abrir
  janelas na frente do usuário. Leia estado e DOM pelo processo main (inspector,
  `executeJavaScript`), não por screenshot.
- **Commits:** mensagens em português. Só faça push, PR ou release quando o usuário pedir.
- **Cuidado com o pnpm:** nunca rode `pnpm install --offline` nem use
  `--config.confirmModulesPurge=false`. Nesta sessão isso **apagou o `node_modules`**. A
  recuperação foi `corepack pnpm install` seguido de `node scripts/ensure-electron.mjs`.

## 2. Onde está o trabalho

| Item | Valor |
|---|---|
| Repositório | `D:\Claude\adrworkspace` (GitHub `ADRAGENCIACRM/adrworkspace`) |
| Branch de trabalho | `fix/code-review-2026-10-20`, incorporada à `main` (fast-forward) |
| Base da branch | `teste-0.1.53-test.4` (`36bcee7`), versão `0.1.53-test.4` |
| Branch principal | `main` |
| Estado | 0.1.53 na `main` e tag `v0.1.53` enviada; app local atualizado e validado (seção 13) |

Commits da branch, do mais antigo ao mais novo:

| Commit | Conteúdo |
|---|---|
| `b216ef4` | Lote 1: bugs do dia a dia |
| `d733afb` | Lote 2: RAM |
| `d618d00` | Lote 3: interface |
| `9ac1c3f` | Lote 4: segurança e robustez |
| `049097c` | Lote 5: dívida técnica |
| `ba99966` | Relatório de ganhos medidos |
| `4f8c12a` | "Manter em memória" por serviço, inclusive WhatsApp, Gmail, Outlook e Teams |
| (este) | handoff + `scripts/measure-ram/` |

Relatórios, que devem ser lidos:

- `docs/reports/code-review/adrworkspace-code-review-geral-2026-10-20.md`: o review completo,
  com todos os achados e arquivo:linha (as linhas são de antes das correções).
- `docs/reports/code-review/adrworkspace-ganhos-code-review-2026-10-20.md`: o que foi feito,
  os ganhos medidos e o que ficou de fora.

## 3. Comandos

```bash
corepack pnpm install           # só se faltar node_modules (NUNCA --offline)
node scripts/ensure-electron.mjs
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint              # equivale a: npx eslint .
corepack pnpm test
corepack pnpm --filter @adr/desktop run coverage   # cobertura real do main (~40,5 %)
corepack pnpm --filter @adr/desktop run pack:dir   # empacota sem instalar (ver docs/RELEASE.md)
```

Medição de RAM, usando o app real com perfil temporário, CRM simulado em HTTPS local e janela
fora da tela:

```bash
corepack pnpm build
bash scripts/measure-ram/run.sh depois run   # ~6 min; cenários de RAM
bash scripts/measure-ram/run.sh depois ui    # ~1 min; lateral horizontal
```

- `WORK` define a pasta de trabalho. O padrão é `D:\Claude\adr-measure`.
- O script gera o certificado com `openssl` (vem com o Git Bash) e precisa da porta 443 livre.
- Para comparar com outra versão: faça checkout do commit, rode `build` e rode o script com
  outro rótulo.
- Números de referência (base → depois) estão no relatório de ganhos. O principal: com teto de
  3 serviços, 14 → 9 páginas e −26 % de working set.

## 4. Arquitetura em 1 minuto

- **App:** Electron (castlabs v44, com Widevine). É um `BaseWindow` com um `WebContentsView` por
  serviço (WhatsApp multi-instância, Gmail, Calendar, Meet, Outlook, Teams, CRM, ADR Browser com
  abas, Spotify, ChatGPT, Claude, Notion, Trello, TikTok, Instagram…).
- **Processo main:** em `apps/desktop/src/main`. O centro é `workspace-window.ts`, com ~7.200
  linhas, quase tudo dentro de `createWorkspaceWindow`, e com **0 % de cobertura**.
- **Módulos puros e testados:** `hibernation.ts`, `meet-integration.ts`, `notifications.ts`,
  `permission-handler.ts`, `service-catalog.ts`, `update-policy.ts` etc. Este é o padrão a seguir.
- **Shell:** HTML/CSS/JS puros em `apps/desktop/src/shell`: `index.html` (a lateral),
  `panel.html` (Configurações), `overlay.html` (paleta, notificações e toast), `prompt.html`,
  `browser-toolbar.html`. Título e lateral agora compartilham `index.html` e uma view.
  Os preloads ficam em `src/preload` e `src/shell/*.cjs`.
- **Pacotes** em `packages/*`:
  - `contracts`: schemas zod;
  - `app-state`: estado versionado e escrita atômica;
  - `workspaces`;
  - `view-lifecycle`: regras de hibernação;
  - `service-adapters`;
  - `crm-core` e `crm-desktop-adapter`;
  - `crm-chrome-adapter`: gera a extensão do Chrome publicada em `extension-updates/`. **Não
    está morto.**
- **Extensão do CRM embutida:** `vendor/adr-crm-extension-0.15.5`. Vale sempre a pasta mais nova.
- **Testes de texto:** `workspace-runtime.test.ts` e `src/index.test.ts` leem o código-fonte como
  texto e avaliam funções extraídas. Ao criar um helper novo usado por `refreshWhatsAppPrivacy`
  (ou funções parecidas), inclua-o nos `globals` do fixture.

## 5. Mudanças de comportamento que o usuário precisa conhecer

1. **"Manter em memória" passou a ser por serviço para todos.** A chave global "Manter WhatsApp,
   Gmail, Outlook e Teams sempre ativos" saiu de Configurações → Notificações.
   - A escolha fica no menu do ícone ("Manter em memória (não hibernar)") ou em Configurações →
     Serviços.
   - Uma migração única (`keep-awake-messengers`) deixou em memória os quatro mensageiros de quem
     tinha a chave ligada.
   - WhatsApp e Gmail novos nascem em memória; Outlook e Teams novos podem hibernar.
   - Mensageiro em memória ainda cede em pressão **crítica** de RAM.
2. **Teto de abas (`maxLoadedViews`) agora funciona.** Acima do teto, os serviços hibernam 90 s
   depois de deixados. Antes, só hibernavam com 10 min de ociosidade.
3. **Trocar de workspace pela lateral** vai direto ao serviço clicado, sem carregar o CRM.
4. **Atualização automática ociosa** exige 5 min sem som em qualquer aba
   (`update-policy.ts: canInstallUpdateNow`).
5. **Backup do Electron 44:** se a pasta de backup for apagada, ela não é refeita.
6. **Ctrl+K:** num campo de texto vai para a página (link no Gmail, Outlook, Notion); fora de um
   campo, abre a busca do app. O usuário aprovou manter assim.
7. **CRM:** páginas de serviço só abrem nele as telas `/contatos`, `/empresas` e `/negocios`
   (`isCrmPagePath`). Se a aba do CRM navegar para fora (por exemplo, num redirect), ela volta
   ao CRM.

## 6. Precisa de teste manual (o usuário ou você, com o app minimizado quando possível)

Checklist original. A seção 11 registra a validação posterior com contas reais e as pendências:

- Ctrl+K num rascunho do Gmail abre o diálogo de link do Gmail.
- Login do Google pela aba do CRM ainda funciona (a guarda nova de `did-navigate` libera
  `google.com` e `youtube.com`).
- PIN do WhatsApp: o foco vai direto para o prompt.
- Mini-barra do Meet durante uma chamada; o toast no canto da área dos serviços; nenhum flash
  escuro no tema claro.
- "Manter em memória" no Outlook e no Teams: desligado, o serviço hiberna depois de 10 min ocioso.
- O instalador gerado (`pack:win`) abre e atualiza um perfil existente sem perder contas.

## 7. Backlog: próximos passos de RAM (em ordem de valor)

Lista original de propostas. O usuário autorizou a execução no Codex com "pode executar" e
"Continue". Consulte a seção 10 e o relatório de execução para o estado atual dos itens:

1. **Medir o CRM real logado.** Os ganhos da troca de workspace foram medidos com o CRM simulado.
   O CRM real deve pesar 400–700 MB. Peça ao usuário para medir com a conta dele ou use o
   diagnóstico do app.
2. **Default dos mensageiros novos.** Hoje Outlook e Teams nascem em memória. Esses são os
   renderers mais pesados (400–900 MB). Proposta: só WhatsApp e Gmail nascem em memória.
   **Decisão do usuário.**
3. **Sonda de "formulário" larga demais** (`packages/view-lifecycle/src/media-active.ts`).
   Qualquer `contenteditable` com texto impede a hibernação, então Notion e Trello provavelmente
   nunca hibernam. Logar o motivo uma vez por view e só considerar o campo que tem
   `document.activeElement`.
4. **Fechar views auxiliares sem uso:** a barra do ADR Browser quando não há abas do Browser
   carregadas. Prompt e mini-barra já fecham.
5. **Juntar titlebar e lateral numa view só:** −1 renderer residente. É uma mudança estrutural
   no `layout()`.
6. **Bloqueador de anúncios** (`ad-blocker.ts`, `onBeforeRequest`) em todas as sessões: cada
   requisição de WhatsApp, Teams e Outlook passa pelo thread JS do main. Restringir às sessões
   do Browser muda o bloqueio fora dele. **Decisão do usuário.**
7. **`console-message`** está registrado em todos os serviços (`workspace-window.ts`, em
   `createServiceView`), mas só Gmail, WhatsApp e o tradutor usam.
8. **Pressão de RAM** calculada com `workingSetSize`, que inclui páginas compartilhadas: dispara
   antes do que deveria. Avaliar o *private working set*.
9. **`calendar-scheduler.ts`** guarda o ICS inteiro só para comparar com a leitura seguinte:
   trocar por hash.
10. **Fontes do shell:** 3 TTF Ubuntu (1 MB) em 7 páginas. Um subset WOFF2 economiza poucos MB;
    antes, conferir a licença Ubuntu Font sobre fontes modificadas.
11. **Opção por serviço "hibernar após X min"** (hoje é um prazo único de 10 min).

## 8. Backlog: dívida técnica e outros

- **Quebrar o `workspace-window.ts`**, um módulo por commit, cada um com teste, seguindo o padrão
  de `update-policy.ts`. Ordem sugerida:
  1. cofre de senhas e Bitwarden;
  2. abas do ADR Browser;
  3. trava do WhatsApp;
  4. atalhos (`onKey`);
  5. IPC da barra do Browser.
- **Prettier em massa** (142 arquivos fora do padrão): fazer só depois de mesclar as branches
  `feat/*` abertas, num commit isolado, e então adicionar `format:check` ao CI.
- **Fora do escopo desta sessão:**
  - unificar a ordem dos botões dos diálogos;
  - Ctrl+K quando o editor está dentro de um iframe (hoje abre a busca);
  - filtro de convite em agenda secundária (`calendar-reminders.ts`);
  - autoplay liberado para qualquer site (`index.ts`): decisão do usuário.
- **Docs de evidência antigos** (`docs/evidencias/*`, `docs/0x-*.md`) citam scripts
  `verify-refinement-*`, que foram removidos. São registros históricos; não precisa mexer.

## 9. Como retomar (sugestão para o primeiro prompt no Codex)

> Leia `HANDOFF.md` e os dois relatórios em `docs/reports/code-review/`. Estamos na branch
> `fix/code-review-2026-10-20`. Rode build, typecheck, lint e test e confirme que tudo passa.
> Depois, responda em português: (a) o que falta testar manualmente e (b) proponha a ordem do
> backlog de RAM da seção 7. Não faça push nem mude nada antes da minha confirmação.

## 10. Continuação no Codex — 20/10/2026

- Autorização para executar recebida. Branch mantida; não houve push, PR, release nem alteração
  do app instalado. O código está como alterações locais para revisão.
- Implementados: sonda de edição no preload com proteção de rascunho após perder foco; log de
  bloqueio uma vez por view; fechamento/recriação da barra auxiliar; título e lateral numa view;
  listeners de console só nos serviços que os usam; hash no cache ICS; prazo de hibernação por
  serviço em Configurações → Serviços → menu do serviço.
- Conferir o caminho real revelou que Outlook/Teams novos já eram hibernáveis. WhatsApp/Gmail
  não recebiam o padrão em todos os caminhos: corrigido e testado sem reescrever preferências.
- Adblock continua em todas as sessões. Métrica da pressão e fontes mantidas: sem evidência para
  prometer redução de RAM nesses itens. Adicionado script somente leitura de working set privado.
- Validação: build, typecheck, lint e **765 testes** passaram; prova do app real em perfil
  temporário passou nas 36 combinações de layout, no ciclo da barra auxiliar, no rascunho
  protegido, no prazo por serviço e no foco do prompt. Sem screenshots, conforme a regra.
- Nesta etapa, a medição do CRM real logado estava pendente porque o app instalado estava sem
  inspector. Essa limitação foi resolvida na continuação descrita na seção 11.
- Roteiro e interpretação das métricas: `scripts/measure-ram/README.md`.
- Comparação com CRM simulado, uma rodada antes/depois: um processo a menos em todos os
  cenários; working set de abertura 929 → 844 MiB e platô com teto 3 de 2.692 → 2.613 MiB.
  O platô varia dentro do ruído histórico; não extrapolar o ganho para contas reais.
- Evidências e resultados: `docs/reports/code-review/adrworkspace-execucao-ram-codex-2026-10-20.md`.

## 11. Validação com sessões reais — 20/10/2026

- O usuário adicionou Outlook e Teams e autorizou aproveitar as sessões conectadas do workspace.
  O diagnóstico do app instalado foi habilitado sem reiniciá-lo. Os testes usaram cópias isoladas
  em `D:\Claude\adr-real-validation-20261020`, sem carregar cópias do WhatsApp.
- CRM real autenticado, em `/insights`: `/api/auth/me` respondeu 200 nas seis leituras.
  Um boot por versão e três leituras por boot, com janela minimizada e viewport emulado de
  1212 × 764: 9 → 8 processos; mediana do working set somado 1.354,5 → 1.250,6 MiB.
  Working set privado somado 294,2 → 293,9 MiB: **não confirma economia de RAM privada**.
  O renderer principal do CRM foi identificado pelo PID; resultados e limites estão no relatório.
- O Windows zera o viewport nativo quando a janela está minimizada. As primeiras séries sem
  viewport emulado foram descartadas da comparação principal; não representam a interface completa.
- Outlook e Teams carregaram as interfaces autenticadas no código alterado. Com “Manter em
  memória” desligado na cópia, ambos hibernaram e tiveram os WebContents destruídos em até
  162 s. O padrão é 10 min, limitado a 2 min quando minimizado, com verificação a cada minuto.
  Ambos reabriram em novos WebContents mantendo a sessão, sem novo login.
- O aviso “Configuração recuperada” mostrado nesta continuação veio da semente temporária:
  `activeServiceId: null` era inválido. Corrigido omitindo o campo e validando o schema antes
  de abrir o app. Os dois arquivos recuperados confirmam esse único erro; o perfil instalado
  passou pelo schema e não contém arquivos `state.v1.json.corrupt-*`.
- Gmail: compositor aberto e rascunho de teste descartado; nenhum envio. Ctrl+K permanece
  pendente porque a janela minimizada não recebeu foco nativo de teclado.
- Ainda pendentes: entrada humana numa reunião privada para validar chamada, notificações reais,
  fluxo completo do OAuth Google, PIN real (desabilitado no perfil) e instalador. O usuário recebeu
  instruções para Teams → Calendário → Reunir agora; ainda não foi observada chamada ativa.
- Sem push, release, instalação ou alteração de código de produto nesta etapa de validação.

## 12. Continuação dos testes de chamada e permissões

- O usuário autorizou mostrar apenas a cópia de teste para as etapas que dependem de foco;
  a exceção não autoriza trazer o app instalado para a frente.
- Foi possível ingressar numa reunião privada do Teams na cópia, sem convidados, com câmera
  desligada e microfone selecionado como “Nenhum”. A sonda detectou mídia ativa na chamada.
  A proteção automática por ociosidade ainda **não foi concluída**: a tentativa de usar o IPC
  de hibernação manual encerrou a view, pois esse comando é forçado. Não interpretar esse
  resultado como falha ou aprovação da proteção automática.
- O aviso do Teams sobre câmera/microfone negados apareceu na cópia em que a automação havia
  negado mídia propositalmente para evitar captura. Essa cópia foi fechada. O perfil instalado
  indicou câmera/microfone liberados pelo Windows, sem permissões de mídia lembradas para Teams
  e sem o aviso ativo naquele momento. A cópia atual voltou à política normal do produto.
- Acrescentados dois testes do handler para áudio/vídeo do Teams na sessão compartilhada com
  Outlook, incluindo pedido do iframe do calendário. O check deixa o pedido chegar ao diálogo;
  a autorização depende da resposta do usuário, e câmera/microfone são lembrados separadamente.
- Build, typecheck, lint e **767 testes** passaram (613 desktop + 154 pacotes).
- O usuário selecionou a conta Google e confirmou que a caixa de entrada abriu na nova cópia.
  A preparação posterior abriu um compositor e inseriu o marcador local de teste, sem envio.
  Ctrl+K ainda não foi entregue nem aprovado; esse rascunho temporário pode continuar aberto.
- O Computer Use foi interrompido pelo Esc físico. Não retomar controle da tela, nem executar
  ações equivalentes pelo DOM, até autorização explícita do usuário para continuar. A resposta
  sobre a caixa de entrada confirma o login; não revoga essa interrupção.
- Após a retomada: concluir Ctrl+K no rascunho de teste, descartar somente esse rascunho, repetir
  a chamada pelo timer automático e minimizar novamente a cópia após as etapas de foco.
- Artefatos desta etapa ficam em `D:\Claude\adr-real-validation-20261020`. O comando manual
  não deve ser usado como verificador da política automática de hibernação.

## 13. Handoff de volta ao Claude — estado atual

### Repositório e autorização

- Abrir **`D:\Claude\adrworkspace`**, branch **`fix/code-review-2026-10-20`**. A pasta da
  conversa do Codex era `D:\Claude\Lockstock`; ela não é o repositório deste trabalho.
- HEAD conferido: **`853b91c`**, `docs: handoff da sessão de code review e script de medição de RAM`.
  As alterações posteriores do Codex continuam no working tree, com arquivos novos sem
  rastreamento. Conferir `git status --short`; não fazer reset, checkout destrutivo ou clean.
- O usuário autorizou implementar e validar. Não houve novo commit, push, PR, release,
  instalação sobre o perfil real ou envio de emails/convites nesta continuação.
- Português, arquivos em D:, sem screenshots. Preferir DOM pelo processo main. Manter o app
  minimizado; o usuário autorizou mostrar **somente a cópia de teste**, temporariamente, para
  foco de Ctrl+K/ingresso em chamada. Não trazer o app instalado para a frente.
- O Esc havia interrompido o Computer Use, mas o usuário autorizou a retomada com
  **“pode continuar”**. Depois pediu este handoff; os testes foram interrompidos para a transferência.
- Não executar `pnpm install --offline` nem `--config.confirmModulesPurge=false`.

### Código pronto para revisão

As alterações e justificativas estão na seção 10 e no relatório de execução. Principais arquivos:

- `apps/desktop/src/main/workspace-window.ts`, `src/shell/index.html`, `internal-surfaces.css`,
  `shell-preload.cjs`: título/lateral em uma view, barra auxiliar sob demanda e correções de
  ciclo de vida/layout. `src/shell/titlebar.html` foi removido intencionalmente.
- `apps/desktop/src/preload/form-activity-preload.cjs` (novo), `scripts/copy-preload.mjs`,
  `packages/view-lifecycle/src/media-active.ts`: edições reais protegem rascunhos mesmo após
  perder foco; conteúdo editável intocado pode hibernar; falhas continuam conservadoras.
- `apps/desktop/src/main/hibernation.ts`, `src/shell/panel.html`, `packages/contracts/src/index.ts`,
  `packages/view-lifecycle/src/hibernate.ts`: prazo opcional por serviço e log de bloqueio
  uma vez por WebContents.
- `service-catalog.ts` e `packages/service-adapters/src/presets.ts`: padrões consistentes;
  Outlook/Teams já eram hibernáveis, WhatsApp/Gmail novos nascem em memória.
- `calendar-scheduler.ts`: hash do ICS em lugar de guardar seu texto completo no cache.
- `permission-handler.test.ts`: dois testes de áudio/vídeo do Teams na sessão compartilhada
  com Outlook; nenhuma mudança de política para forçar o resultado.
- `scripts/measure-ram/`: contadores do Windows, README e verificador de integração.
  Há testes novos/ajustados e ajustes de lint; incluir os arquivos novos ao revisar o diff.

Adblock continua em todos os serviços. Política de pressão e fontes foram mantidas. A divisão
de `workspace-window.ts` e a formatação em massa são backlog separado.

### Verificações concluídas

- Última execução: **build, typecheck, lint e 767 testes passaram** (613 desktop + 154 pacotes).
  Não houve mudança de código de produto depois; as últimas edições são documentação e
  helpers fora do repositório. `git diff --check` passou, com avisos de conversão CRLF.
- Integração em perfil temporário: 36 combinações de layout/zoom, ciclo da barra auxiliar,
  prazo por serviço, rascunho protegido após o prazo e foco do prompt. Isso não valida aparência
  visual ou PIN real. Comandos na seção 3 e no README da medição.
- CRM real medido (seção 11): autenticação 200, rota `/insights`, viewport emulado 1212 × 764,
  janela minimizada, um boot por versão e três leituras correlacionadas. Processos 9 → 8;
  working set total 1.354,5 → 1.250,6 MiB; privado 294,2 → 293,9 MiB.
  **Não prometer economia de RAM privada nem extrapolar para todo o uso diário.**
- Outlook/Teams autenticados: hibernaram e destruíram os WebContents em até 162 s com “Manter
  em memória” desligado na cópia; reabriram sem novo login. Não prova notificações durante
  hibernação. No Windows minimizado foi necessário emular viewport para carregar a UI completa.
- **Ctrl+K no Gmail agora passou.** Com editor e janela focados, tecla nativa abriu o diálogo
  **“Editar ou inserir link”**, com campos “Texto âncora” e “Link”; a busca do ADR não abriu.
  Evidência: `D:\Claude\adr-real-validation-20261020\gmail-ctrl-k-real-proof.json`.
  Rascunho próprio descartado, sem envio. A consulta final confirmou ausência do marcador
  de teste e do diálogo de link (`handoff-runtime.json`).

### Avisos relatados pelo usuário

1. **“Configuração recuperada”**: os dois arquivos temporários tinham `activeServiceId: null`,
   inválido pelo schema. Semente corrigida omitindo o campo e validando antes de lançar.
   Perfil instalado válido, sem arquivos de estado corrompido encontrados. Não alterar o
   schema para aceitar erro da fixture; não afirmar que toda falha histórica foi descartada.
2. **Teams sem câmera/microfone**: a cópia antiga negava mídia por handlers temporários para
   evitar captura; isso provocou o aviso. Ela foi fechada. A atual usa os handlers normais.
   O instalado indicou permissões do Windows concedidas, sem grants lembrados para Teams e
   sem aviso naquele momento. Hardware real não foi validado. Autenticação e permissões
   devem ser decididas pelo usuário; não automatizar consentimento.

### Próximos passos, em ordem

> **Plano concluído (Claude, 14h):** o CRM não tem login Google (item não se aplica, confirmado pelo usuário), e a mini-barra do Meet foi aprovada pelo usuário no app instalado `0.1.53-test.4`. A aparência foi verificada sem screenshot: o fundo nativo não seguia a troca de tema (flash escuro no claro), corrigido com `syncThemeBackgrounds` e medido nos quatro estados de tema. Todos os itens desta seção estão fechados; o histórico abaixo fica como registro.

> **Fechamento (Claude, 13h30):** a chamada no Teams foi aprovada com o build novo; logpoints provam que o `teamsInCall` barra a hibernação. O Outlook reaberto depois de hibernar recebe emails ao vivo. **Achado corrigido:** o contador do Outlook agora vem do `title` da Caixa de Entrada (`unreadFromOutlookFolderTitle`), validado ao vivo na cópia (6771 → 6772 → 6771). Continuam **dependendo do usuário**: login Google pelo CRM (exige senha), mini-barra do Meet e aparência (dependem do Google), e o instalador, depois **feito com autorização** (13h55: app instalado atualizado para `0.1.53-test.4` por `update:local` com VMP, perfil real preservado; backups em `adr-real-validation-20261020`). A cópia de teste foi encerrada; o app instalado não foi tocado.

> **Atualização (Claude, 13h20):** Teams fora de chamada continua hibernando com o build novo. O PIN do WhatsApp tinha dois defeitos do `d733afb` (prompt encadeado invisível e desbloqueio preso depois do primeiro prompt), agora corrigidos e validados ponta a ponta na cópia. As notificações em aba hibernada foram analisadas. Detalhes na seção “Continuação do plano” do relatório. **Dependem do usuário:** Teams em chamada com o build novo, login Google pelo CRM, notificação real depois de reabrir, mini-barra do Meet e aparência, e atualização pelo instalador.

> **Atualização (Claude, 11h58):** o item 1 foi **concluído e aprovado**. Foram 6 min de timer natural, minimizado, sem hibernação manual, com o mesmo WebContents e a chamada mantida. A proteção vem da sonda de DOM (`<audio>` ativo), não de detector próprio do Teams. Evidência: `teams-auto-protection.json`. A sala foi encerrada, o diagnóstico fechado e a cópia ficou minimizada. Detalhes no relatório de execução. Os itens 1 e 2 abaixo ficam como histórico. Em seguida, `serviceBusy` passou a usar `teamsInCall` (`#hangup-button`, com prazo de 3 s), com testes. Foram 769 testes verdes, sem revalidação em chamada real com o build novo.

1. **Proteção automática da chamada no Teams.** Na primeira cópia houve ingresso em sala
   privada, câmera desligada/microfone “Nenhum”, e sonda com mídia ativa. O teste não terminou:
   `shell:hibernate-service` força fechar a view e encerrou a sala vazia. **Nunca usar o comando
   manual como teste da proteção automática.** Repetir sala privada, confirmar `#hangup-button`
   (`data-tid="hangup-main-btn"`, rótulo “Sair”), desligar “Manter em memória” só na cópia e
   minimizar. Observar timer natural por mais de 2 min mais uma passada de até 60 s, comprovando
   mesmo WebContents e chamada preservada. Ao concluir, sair da própria sala. Sem convidados
   ou gravação de áudio/vídeo.
2. Na tentativa mais recente, Teams autenticado e calendário carregado, mas os cliques no
   flyout “Reunir agora” foram inconsistentes. UIA respondeu `coordinate input geometry is
   unavailable`; DOM mostrou “Iniciar uma reunião agora” em algumas consultas, sem confirmar
   início. **Não há chamada ativa na cópia atual.** Pode ser mais direto o usuário abrir a
   sala nela do que repetir helpers de clique. Não atribuir falha da automação ao produto.
3. Ainda sem prova: OAuth Google completo pelo CRM (cookies não substituem o fluxo),
   notificações reais após hibernação, PIN real do WhatsApp (desabilitado no perfil), mini-barra
   do Meet/aparência/flash de tema e atualização de perfil pelo instalador. Não deslogar contas
   reais nem instalar sobre o app em uso para testar. Testes verdes não aprovam esses itens.
4. Revisar diff e entregar limites da validação. Não fazer push por causa desta transferência.

### Instâncias e artefatos

- Pasta de evidências/helpers: **`D:\Claude\adr-real-validation-20261020`**.
- Às 11h44 de Brasília: instalado PID **9384**; cópia PID **4556**, janela
  **`ADR Workspace - Teste contas reais`**, perfil
  `D:\Claude\adr-real-validation-20261020\real-accounts-focused-1 Dev`.
  **Cópia deixada minimizada**, sem chamada/prejoin e sem rascunho de teste Gmail.
  Evidência: `handoff-runtime.json`. PIDs/handles são históricos: conferir antes de usar.
- A cópia encerra automaticamente 60 min após o lançamento às 11h26 (~12h26). Não presumir
  que continuará aberta. Não reiniciar o instalado nem matar seus processos.
- `inspect.cjs` usa `ADR_INSPECT_PORT`, padrão 9229. A cópia usou **9233**. Diagnóstico fechado
  ao finalizar o handoff; se necessário, habilitar só após conferir PID/caminho da cópia.
  Não avaliar scripts mutantes na porta do instalado por engano.
- `real-accounts-focused.cjs`/`launch-real-accounts-focused.cjs` preparam a cópia completa e
  regravam a semente temporária ao lançar. Não abrir duas instâncias no mesmo userData.
  `validated-services-seed.json` passou pelo schema; não usar sementes antigas inválidas.
- Cookies foram transferidos por APIs oficiais e arquivo **DPAPI CurrentUser**. Não imprimir
  cookies/tokens/conteúdo de mensagens nem adicionar esses dados ao Git.
- **Não rodar cegamente helpers antigos**: `private-call-start.js` nega mídia;
  `*-manual-protection.js` força hibernação; alguns sobrescrevem evidências anteriores.
  São ferramentas de investigação, não uma suíte segura para executar inteira.
- Evidências: `result-before-crm-viewport-1.json`, `result-after-crm-viewport-1.json`,
  `full-service-auth.json`, `hibernation-final-full.json`, `full-service-reopened.json`,
  `configuration-recovery-check.json`, `gmail-ctrl-k-real-proof.json`, `handoff-runtime.json`.

### Prompt sugerido para o Claude

> Trabalhe em `D:\Claude\adrworkspace`, branch `fix/code-review-2026-10-20`. Leia o HANDOFF.md,
> especialmente a seção 13, e `docs/reports/code-review/adrworkspace-execucao-ram-codex-2026-10-20.md`.
> Preserve as alterações locais sem commit. CRM logado, hibernação/reabertura de Outlook/Teams
> e Ctrl+K no Gmail já foram validados; build, typecheck, lint e 767 testes passaram. Retome a
> proteção automática da chamada no Teams pelo timer natural, sem forçar hibernação manual,
> e depois as pendências reais restantes. Mantenha o app minimizado; mostrar somente a cópia
> de teste é autorizado quando foco for indispensável. Sem screenshots, push ou instalação
> sobre o perfil real. Não repita medições concluídas sem motivo.
