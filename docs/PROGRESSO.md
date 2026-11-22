# Progresso do plano mestre (execução contínua)

Atualizado: 2026-10-13

| # | Refinamento | Status |
|---|---|---|
| 1 | Requisitos/orçamento | PASS 100% |
| 2 | Matriz referência | PASS 100% |
| 3 | Monorepo/toolchain | PASS 100% |
| 4 | Licenças | PASS 100% |
| 5 | Canal extensão | PASS 100% (CRX 0.12.5 publicado) |
| 6 | Identidade extensão | PASS local (privada no cofre) |
| 7 | Contratos CRM | PASS 100% |
| 8 | crm-core puro | PASS 100% |
| 9 | Adapter Chrome | PASS 100% |
| 10 | Spike CRM desktop | PASS (`.deb` + login humano ok) |
| 11 | Spike Google | PENDENTE no Windows: o cartão do app ocultava o erro original e tinha falsos positivos; correção local preserva a página Google, ainda sem login real validado |
| 12 | Spike Spotify/CastLabs | PENDENTE (conta CastLabs + Widevine) |
| 13 | Estado versionado | PASS 100% |
| 14 | Partições | PASS 100% |
| 15 | BaseWindow/views | PASS 100% (ciclo real em workspace-window) |
| 16 | Workspaces | PASS 100% |
| 17 | Serviços | PASS 100% |
| 18 | Ciclo de vida views | PASS 100% |
| 19 | Recovery de crash | PASS 100% |
| 20 | Soft delete 30 dias | PASS 100% |
| 21 | Preload CRM isolado | PASS 100% |
| 22 | Auth CRM por workspace | PASS 100% |
| 23 | whoami + impersonação | PASS 100% |
| 24 | Identidade da conversa | PASS 100% |
| 25 | Lookup CRM resiliente | PASS 100% |
| 26 | Respostas rápidas | PASS 100% |
| 27 | Tradução | PASS 100% |
| 28 | Transcrição | PASS 100% |
| 29 | Cache de transcrição | PASS 100% |
| 30 | Kill switch do painel | PASS 100% |
| 31 | Múltiplos WhatsApps | PASS 100% |
| 32 | Gmail/Calendar | PASS histórico; login Windows atual PENDENTE de nova validação (ver investigação de 25/09/2026) |
| UI | Shell serviços + notificações | PASS (rail dinâmica, catálogo, mute WA) |
| UI | Workspaces + drag reorder | PASS |
| 33 | YouTube | PASS (embed; soak 30min PENDENTE) |
| 34 | Spotify | PASS (player desktop: User-Agent sem "Electron" só na aba; Widevine + VMP tocando no Windows em 06/10) |
| 35 | ADR Browser | PASS (barra só no Browser; YT/Gmail/Calendar/Spotify sem chrome) |
| 36 | Downloads/uploads/permissões | PASS (fila, nome único, cancelar, prompt por origem) |
| 37 | Abrir Chrome/Brave | PASS (descoberta + fallback sistema) |
| 38 | Identidade visual + a11y | PASS (tema, escala, Ctrl+K, foco, ícone YT real) |
| 39 | Hibernação + observabilidade | PASS+ (CRM lazy + LRU; pin de mídia cede sem áudio; probe no campo focado; pressão medida) |
| 40 | Empacotar/atualizar | PASS estável 0.1.47 (rc testada no Windows; `promote` publica o artefato testado) |
| IA | ChatGPT, Claude e Gemini | PASS (login próprio / sessão Google; login social em janela própria) |
| Login Google | "Continuar com o Google" nos serviços de login próprio usa as contas do Gmail | PASS local (0.1.50-rc.1; login real pendente de validação humana) |
| TikTok | Serviço com login próprio, uma sessão por conta | PASS local (0.1.50-rc.1) |
| Google Meet | Sessão Google do workspace, apresentar tela, links de reunião na aba, reunião protegida | PASS local (0.1.50-rc.2; reunião real pendente de validação humana) |
| Reuniões | Não perturbe em chamada, Ctrl+Alt+M, mini-janela, lembrete por iCal, agendar pelo WhatsApp, registro no CRM | PASS local (0.1.50-rc.3; validação humana pendente) |
| Perfil | Backup a cada instalação + "Fazer backup agora"; permissões revogáveis; mensageiros sempre ativos | PASS local (0.1.50-rc.3) |
| Assinatura | Certificado autoassinado + scripts (grátis); opções pagas documentadas | Ferramentas prontas (`docs/ASSINATURA.md`); certificado a criar pelo usuário |
| Notificações | Limpar notificações por serviço | PASS (só reaparece com mensagem/e-mail novo; sobrevive a reiniciar) |
| Segurança | Bloqueio local do WhatsApp por PIN | PASS (cofre `safeStorage`, recuperação explícita e limite de tentativas) |
| Extensão Chrome | Autoenvio desligável no menu de tradução | PASS local (`0.15.1`; publicação do CRX pendente) |
| Lusha | Consulta via rota autenticada do CRM por URL de perfil LinkedIn; preview, revelação confirmada e gate pelo login CRM | PASS local (chave criptografada no CRM; sem scraping) |

## 0.1.50 — TikTok, Google Meet, login Google com as contas do workspace e revisão

- **Estável 0.1.50 (14/10/2026):** `package.json` de volta à versão base e tag
  `v0.1.50` para o workflow gerar o instalador com VMP; a publicação no
  `adrworkspace-releases` (o que a atualização automática enxerga) segue o
  `workflow_dispatch` com o smoke de `docs/windows-release-smoke.md`. Verificadores
  do workflow rodados localmente antes da tag (Configurações: transbordo da linha
  do iCal corrigido).
- **rc.5 — 10 melhorias:** barra própria na mini-janela do Meet; e-mails na
  escolha de conta Google + "Outra conta…" pelo Gmail; negócio e anotação no
  registro do CRM (`/api/crm/deals?contactId=`); próxima reunião e erros claros no
  status da agenda (leitura de 24 h); menu "Mais ▾" no painel do WhatsApp; aviso
  do resultado do backup com tamanho; orientação quando o Google recusa o login;
  estado incremental para as telas (`state-diff.ts`); `permission-handler.ts` e
  `profile-ipc.ts` fora do `workspace-window.ts`; cobertura com
  `@vitest/coverage-v8` (script `coverage`). 3 revisões depois (funcionalidades,
  segurança, testes): negócio filtrado pela empresa do contato e `companyId`
  junto do `dealId`; prompt opcional (`empty=1`) com "Registrar"/cancelar;
  "Mais ▾" fecha ao escolher/Esc e usa posição fixa; seletor de conta sem
  reentrada (`choosing`) e cache de e-mails 60 s; `onCalendarChanged` →
  `broadcastState`; `shell:get-state` transmite antes de responder;
  `Set-Status failed` quando o app não fecha; popups da janela de login
  gated por foco + 1,5 s; trava de navegação na barra da mini-janela;
  `showPendingBackupNotice` fora do registro de IPC.
- **rc.6 — notificação do WhatsApp:** `openWhatsAppNotificationChatScript` casa o título inteiro antes do pedaço antes do "|" (nomes como "Fulana | ADR Agência"), confirma pelo texto de `#main header` além de `span[title]` e resolve `true` quando já clicou na linha única.
- **rc.6 — pendências das revisões:** `calendar-scheduler.ts` (agenda fora do
  `meet-integration.ts`, sem Electron, expansão reaproveitada por 1 h com o
  mesmo ICS) e `hibernation.ts` (decisões e passada fora do
  `workspace-window.ts`, abas injetadas); `popup-choice.ts` para os três menus
  com prazo; sonda do Meet pendente conta como falha (aba travada encerra a
  chamada em 1 min e libera a hibernação); `setIoRetrySleep` no app-state;
  AST em cache e `vi.waitFor` no teste de runtime; `formatBytes` arredonda
  antes da unidade; `backupFailureToShow` interno; comentários em português.
  Decisão registrada: `redirect_uri` por site, não por host (ver
  `isServiceOAuthRedirect`). Sem testes ainda: `google-auth-window.ts`,
  `screen-share.ts`, `downloads.ts`, `updates.ts`.
- **rc.4 — 3 revisões (fluxos de ponta a ponta, ciclo de vida/desempenho,
  testes/manutenção):** agenda expandida numa worker thread (medido: 1–8 s de
  main thread travado em agendas grandes) com leitura mais nova vencendo
  (geração) e lembrete atrasado por suspensão descartado; retry de E/S do save
  limitado a ~150 ms (EBUSY/EPERM); sonda do Meet sem acumular e só encerra a
  chamada após 1 min sem resposta; atualização ociosa só com o computador parado;
  registro no CRM com nova busca e item no menu do Meet; Meet de qualquer
  workspace; backups em %LOCALAPPDATA% com `backup-status.json` (aviso de falha
  e de backup em andamento); funções puras extraídas e testadas
  (`grantNames`, `isServiceOwnSite`, `messengerStaysAwake`, `miniWindowBounds`,
  `planReminders`, `backupScriptArgs`, `createOneShot`, regras do guard);
  testes de horário de verão, exceção cancelada e `withIoRetry` sem dormir.
- **rc.3 — reuniões e perfil:**
  - `meet-integration.ts` orquestra a reunião: sonda "na chamada" a cada 10 s
    (`MeetCallTracker`), "não perturbe" de WhatsApp/Gmail (`meetingQuiet` no
    guard), atalho global Ctrl+Alt+M (`MEET_TOGGLE_MIC`, registrado só durante a
    chamada), mini-janela no fim do `layout()`, aviso para registrar no CRM ao
    sair (`crm-meeting-log.ts`: `POST /api/crm/activities` tipo `meeting` +
    `PATCH status DONE`; exige contato com empresa) e lembrete da agenda
    (`calendar-reminders.ts` com ical.js 2.2.1, MPL-2.0: recorrência, exceções e
    fusos; endereço iCal cifrado com safeStorage e nunca logado).
  - "Agendar reunião" no painel do WhatsApp: comando `scheduleMeeting` da ponte
    do CRM → evento do Calendar já preenchido (`vcon=meet`), convidado pelo
    e-mail do contato do CRM com o mesmo telefone, aberto na aba do Calendar.
  - `keepMessengersAwake` (padrão ligado): WhatsApp/Gmail só hibernam em pressão
    crítica de RAM.
  - Privacidade: lista e revogação das permissões lembradas.
  - Backup: `build/backup-profile.ps1` roda no instalador (`build/installer.nsh`,
    `customInstall`, app fechado, mantém 3 `auto-*`) e no "Fazer backup agora"
    (o app agenda o script, fecha, o script copia e reabre o app).
  - Escolha da conta Google na janela de login quando há mais de uma.
  - Divisão do `workspace-window.ts`: ponte do login Google
    (`google-auth-window.ts`), compartilhamento de tela (`screen-share.ts`) e
    reuniões (`meet-integration.ts`) saíram para módulos com dependências
    explícitas.
  - Assinatura: `scripts/assinatura/` + `docs/ASSINATURA.md`.

- **Google Meet** (rc.2): serviço na sessão Google do workspace; apresentar tela
  com seletor próprio (o Electron não tinha nenhum: "Apresentar agora" falhava em
  qualquer serviço); links de reunião de Calendar/Gmail/WhatsApp/CRM abrem na aba
  do Meet; numa sala a aba não hiberna, não é estrangulada e a atualização espera.
  Detalhes em `17-servicos.md`.

- **"Continuar com o Google" no ChatGPT (e Claude, Notion, Trello, TikTok):** o
  Google recusava o login (`signin/rejected`, "navegador não compatível") porque
  a partição isolada do serviço não tem conta Google. Agora a etapa do Google roda
  numa janela na partição Google do workspace (contas do Gmail já logadas) e só o
  retorno OAuth volta para a aba. Detalhes e limites em `17-servicos.md`.
- **TikTok** como serviço: login próprio, várias contas, ícone na barra lateral.
- **Estado tolerante a versão:** serviço/perfil de tipo desconhecido (arquivo de
  versão mais nova) fica estacionado em `parkedServices`/`parkedProfiles` em vez
  de invalidar o arquivo; campos novos sobrevivem a uma versão velha gravar
  (`.passthrough()`). Antes, voltar uma versão recomeçava do zero (deslogado).
  **Builds até a 0.1.49 não têm isso:** reinstalar a 0.1.49 depois de adicionar o Meet ou o
  TikTok ainda zera o estado nela.
- **Windows segurando arquivo:** leitura e rename do estado repetem em
  EBUSY/EPERM/EACCES; principal em uso no boot vira aviso e saída, nunca recomeço
  do zero por cima do arquivo bom.
- **Vida das views:** CRM destruído sai do mapa (antes: exceção a cada resize e
  tela preta); aba que se fecha sozinha não entra em laço; WhatsApp redirecionado
  para fora em laço para após 3 vezes/min; nova tentativa de carga usa a URL que
  falhou e não empilha timers; sonda de mídia não acumula promessas em renderer
  travado; menu de contexto usa a view atual; save adiado é gravado ao sair.
- **Atualização não reinicia no meio do uso:** baixada, espera o app minimizado
  ou 5 min sem uso, sem nada tocando nem baixando; sair do app antes disso instala
  na saída. "Instalar" nas Configurações continua imediato.
- **Segurança:** popups só da aba da frente com foco (título mostra o domínio);
  notificação liberada sem pergunta só para o site do próprio serviço; microfone e
  câmera lembrados separadamente (o "microfone/câmera" já permitido antes continua
  valendo); aviso de protocolo externo só da aba da frente;
  downloads `.rdp`, `.library-ms`, `.search-ms`, Office com macro etc. tratados
  como executáveis e "Abrir" só é o botão padrão para tipos inofensivos; logs de
  diagnóstico cortam fragmento de URL e `mailto:`/`tel:`; toast do WhatsApp com
  PIN não mostra o texto da mensagem; cópia da Lusha não passa pelo DOM do LinkedIn.
- **Outros:** helper do otimizador não derruba o app com EPIPE; cópia de perfil
  interrompida é apagada antes de tentar de novo; clique em notificação barrado pelo
  login CRM não abre a conversa horas depois; SBOM com a versão real e
  `SHA256SUMS` cobrindo o `.exe`.
- **Revisão:** 5 revisões paralelas (diff, ciclo de views, segurança, pacotes de
  estado, notificações/atualizador/shell) + 1 de verificação de todo o diff; 7
  rodadas de correção. Popup de login com Google não abre duas vezes.
- **Validação:** build, typecheck, lint e todos os testes (desktop 334, app-state
  14, workspaces 5, demais pacotes) passam; smoke em `pnpm dev` abriu 1 janela e
  fechou limpo. Login Google real, TikTok real e instalação por cima do perfil
  real ficam para o teste humano com o instalador.
- **Decidido na rc.3:** WhatsApp e Gmail ficam acordados por padrão
  (`keepMessengersAwake`; só cedem em pressão crítica de RAM), porque hibernados
  não notificam nem atualizam o contador. Desligável em Notificações.
- **Revisão da rc.3:** 3 revisões paralelas (funcionalidades do Meet e agenda,
  segurança das superfícies novas, regressões de refatoração/UI). Corrigidos:
  troca de workspace encerrava a chamada do outro; link do Meet não abria sem aba
  do Meet; popup de login travava no retorno; LRU estourava o teto com mensageiros
  ativos; "não perturbe" calava o próprio Meet; reunião adiantada sem lembrete;
  convite de desconhecido virava lembrete; senha do certificado na linha de
  comando do signtool e chave órfã no Windows; seletor de tela sem o site e
  aceitando iframe; backup seguindo junções e disputando com a atualização.

## 0.1.47 — IA, limpar notificações e Spotify

- **Serviços de IA:** Claude (login próprio por conta, como o ChatGPT) e Gemini
  (sessão Google do workspace). Login social em janela própria; ver
  `17-servicos.md`.
- **Limpar notificações** (botão direito no WhatsApp/Gmail): grava em
  `settings.clearedUnread` quantas não lidas havia; o contador da barra lateral e
  da barra de tarefas mostra só o que passar disso. Ler parte do que havia baixa a
  base; recarga/hibernação (título sem contador e volta igual em até 2 min) não
  reexibe; ler tudo e receber de novo reexibe. Regra em `nextClearedUnread`.
- **Spotify não tocava:** com "ADRWorkspace/… Electron/…" no User-Agent o Spotify
  entrega o `mobile-web-player` (`fallback=getapp`), que não toca faixas. A aba do
  Spotify usa o User-Agent sem esses tokens; a sessão Google compartilhada mantém
  a identidade nativa que o login do Google exige (decisão da 0.1.39).
- **RAM:** a barra do ADR Browser só carrega quando um serviço com barra aparece.
  Trocar de aba grava o estado com atraso de 2 s, sem fsync a cada clique.
- **Revisão de código:** PIN com contador persistente para desbloquear, desativar e
  trocar; Lusha em mundo isolado; CRM com timeout de 30 s; atualizador volta a
  verificar após 15 min parado; mais extensões perigosas nos downloads.
- **Validação em 06/10:** rc.4 e rc.5 instaladas por cima do perfil real (com
  backup antes): 4 WhatsApps, Instagram, Gmail, Drive, Calendar, YouTube, Gemini e
  ChatGPT continuaram logados; Spotify tocou; "Limpar notificações" escondeu o
  contador e manteve a escolha após reiniciar.

## Bloqueio local do WhatsApp por PIN

Configurações → Privacidade permite ativar bloqueio com PIN numérico de 4 a 12
dígitos. O PIN não entra em `state.v1.json`: fica cifrado pelo Electron
`safeStorage` em `vault/whatsapp-lock.v1.json`, com permissão `0600` quando o
sistema suporta esse modo.

Ao abrir WhatsApp bloqueado, o app pede PIN antes de expor a view. Cinco falhas
consecutivas iniciam espera de 30 segundos; PIN correto limpa o contador.

Desde 01/10/2026: o PIN é um cofre por sessão (`vault/whatsapp-lock.<id>.v1.json`) e o
global legado é migrado uma vez, com o mesmo PIN — misturar os dois modos fazia
ativar ou desativar UMA sessão desproteger as outras. O limite de tentativas cobre
desbloquear, desativar e trocar o PIN, fica em disco (`vault/whatsapp-pin-attempts.v1.json`),
dobra a espera a cada bloqueio seguido (até 15 min, também quando o relógio do
sistema volta no tempo), esquece falhas após 24 h e zera quando o PIN muda. Com o
chaveiro do sistema indisponível, a recuperação sem PIN não é oferecida.

Se cofre estiver ausente, corrompido ou indisponível, Configurações → Privacidade
oferece recuperação com confirmação explícita. Recuperação desativa bloqueio e
remove cofre, sem tocar em sessões ou no estado de serviços.

Testes cobrem validação numérica, cifragem, comparação exata, cofre ausente e
cofre corrompido. Teste visual Electron isolado abriu com perfil temporário; o
BrowserOS não conectou nesta sessão, então fluxo visual não foi automatizado.

## 0.1.18 — aviso de atualização CRM

Ao abrir o Workspace, o sino e o toast informam que o menu de tradução do CRM
agora permite desligar autoenvio na conversa atual. O aviso acompanha a versão
vendorizada `0.15.1` da extensão.

## 0.1.19 — atualização obrigatória do Workspace

No Windows instalado, ao terminar download validado de uma nova versão, o
Workspace salva estado e sessões, instala e relança automaticamente. O botão
de atualização permanece como contingência se o instalador não iniciar.

## 0.1.20 — atualização silenciosa e PIN por sessão WhatsApp

1. **Atualização silenciosa:** O electron-updater chama `quitAndInstall(true, true)`
   com a flag `/S` do instalador NSIS. O app encerra, atualiza em segundo plano e
   relança automaticamente, sem reabrir a janela de assistente do setup.
2. **PIN individual por sessão WhatsApp:** Configurações → Privacidade lista cada
   instância de WhatsApp cadastrada. O usuário pode ativar/desativar PIN
   individualmente para cada sessão, com chaves cifradas separadas no cofre
   (`vault/whatsapp-lock.<serviceId>.v1.json`) e botão para alterar PIN.
3. **Pedir PIN ao voltar para a aba:** Cada sessão possui a opção de exigir PIN
   sempre que o usuário retornar para a aba (relock ao alternar para outro serviço
   ou minimizar o app).
4. **Bloquear todas as sessões:** Botão de emergência na tela de privacidade para
   trancar todas as instâncias protegidas imediatamente.

## 0.1.26 — card flutuante Lusha, timeout de inatividade e bloqueio granular

1. **Card flutuante da Lusha no navegador:**
   - Diálogos nativos `dialog.showMessageBox` removidos em favor de card escuro injetado via Shadow DOM na página do LinkedIn.
   - Suporte a cópia em um clique por campo (E-mail, Telefone, Nome) e botão "Copiar tudo", além de texto selecionável.
   - Conformidade contínua com `docs/LUSHA.md`: zero scraping de DOM do LinkedIn, autenticação e revelação preservadas pelo CRM.
2. **Correção do modal de prompt:**
   - `prompt.html` agora suporta `label` e `hint` dinâmicos, corrigindo exibição indevida de "Nome" e texto de workspace ao solicitar PIN/senha.
3. **Isolamento estrito de bloqueio WhatsApp:**
   - `resolveWhatsAppLocked` isola cada sessão cadastrada; ativar PIN em uma conta não bloqueia mais contas irmãs sem PIN.
   - Adicionada ação "Bloquear agora" no menu de contexto do botão direito do ícone na barra lateral.
4. **Bloqueio por inatividade com tempo configurável:**
   - `settings.whatsappLockTimeoutMinutes` armazena tempo de ociosidade (padrão 30 min, opções rápidas de 5 min a 2h, personalização em minutos ou desativado).
   - Sessões ociosas acima do limite voltam a exigir PIN automaticamente.

## 0.1.27 — PIN por conta e hibernação sem descarte imediato

1. **Política de PIN realmente individual:**
   - Cada WhatsApp protegido escolhe seu próprio tempo de inatividade, incluindo
     “Nunca”, valores rápidos e minutos personalizados.
   - A opção “Sempre pedir o PIN ao abrir esta aba” fica explícita em cada conta.
   - Estado legado mantém 30 minutos como fallback, sem acoplar novas alterações.
2. **Correção da terceira conta que hibernava ao trocar de aba:**
   - O LRU sob pressão de memória agora respeita a ociosidade calculada antes de
     destruir uma view recém-deixada.
   - Contas `keepAwake` continuam protegidas; áudio ativo continua impedindo hibernação.
3. **Hardening encontrado na varredura:**
   - Uma conta configurada individualmente não pode mais cair silenciosamente no PIN
     global legado quando seu cofre estiver ausente ou corrompido.
   - Atualizações frequentes de badges não apagam o valor personalizado enquanto ele
     está sendo digitado no painel de privacidade.

## "Copiar" do WhatsApp e RAM sob pressão

### O Copiar do menu da mensagem não copiava nada

Sintoma: abrir o menu da mensagem no WhatsApp, clicar em **Copiar**, ir para outra
conversa e dar Ctrl+V — e colar o nada. Sem erro, sem diálogo, sem rastro no
diagnóstico.

O menu de contexto do app (0.1.6) não cobria este caso: ele é do botão direito e
usa `copyImageAt`, do lado do main. O **Copiar** da figura acima é o do próprio
WhatsApp, e ele chama `navigator.clipboard.write()` — que o Chromium só executa
depois de consultar a permissão `clipboard-sanitized-write`.

Duas travas, cada uma bastando sozinha para o clique não fazer nada:

- **A permissão caía no `deny` padrão.** `decidePermission` responde "deny" para
  tudo que não está listado, e clipboard nunca esteve. É a mesma dívida do
  microfone e do `storage-access`: enquanto não havia handler nenhum o Electron
  concedia, e instalar o handler (para poder silenciar notificação) tirou em
  silêncio capacidades que ninguém tinha listado. Agora escrever é "allow" em
  qualquer view de serviço/CRM — é o site que o usuário abriu, e o conteúdo é
  sanitizado pelo Chromium. **Ler** (`clipboard-read`) é o oposto, porque entrega
  ao site o que foi copiado de qualquer outro app: vai a "ask", com a resposta
  lembrada por origem.
- **O documento não estava focado.** `clipboard.write()` exige
  `document.hasFocus()`, e trocar de aba deixava o foco na rail — que foi quem
  recebeu o clique. `showSurface` agora foca a view da frente (mas não rouba o
  foco do prompt modal, da paleta ou do painel de notificações). De quebra, abrir
  o WhatsApp pelo ícone e sair digitando passa a escrever na conversa, e não numa
  view sem campo nenhum.

O anexo de documento (PDF, zip) continua sem "copiar" — nem o Chrome tem.

### RAM: o teto que nunca era atingido

`recommendedMaxLoadedViews` decide quantas views ficam carregadas olhando só o
tamanho da máquina: 8 em 30 GB. Oito renderers de app web passam de 4 GB sem
cruzar limite nenhum — o LRU só roda quando o teto é atingido, então ele nunca
rodava, e o app engordava até o usuário reclamar. Na máquina grande é pior, que é
exatamente onde ninguém percebe antes de doer.

Entrou uma medida real no lugar do palpite. A cada passagem da hibernação (60 s e
toda troca de aba) o app soma o `workingSetSize` de todos os seus processos — a
mesma fonte do export de diagnóstico — e classifica:

| Pressão | Quando | Teto de views | Ociosidade para hibernar |
|---|---|---|---|
| normal | abaixo do orçamento | o de sempre (3/4/6/8) | 10 min |
| high | ≥ orçamento | metade | 3 min |
| critical | ≥ 1,4× orçamento | 1 | 1 min |

O orçamento é 35% da RAM da máquina, preso entre 1,5 GB e 4 GB. A fatia sozinha
não serve: em 8 GB dá 2,8 GB e é justo, em 32 GB daria 11 GB, ou seja, teto
nenhum. O piso existe para a máquina pequena não entrar em pressão com o app
recém-aberto (o boot mede ~2 GB), o que só faria a aba da frente recarregar sem
parar.

Desde 01/10/2026, máquinas com 24 GB ou mais têm teto de 6 GB. Com quatro
WhatsApps "sempre ativos" o app vive entre 3,9 e 4,3 GB, e em 31,6 GB a pressão
alternava normal/alta a cada poucos minutos, cortando o teto de abas pela metade
e tirando a proteção do YouTube pausado. Também desde então, áudio começando ou
parando conta como uso da aba: o prazo de ociosidade de quem toca no fundo
começa quando o som para, não no último clique.

A aba da frente, com a janela visível, continua intocável. Pin de WhatsApp também.
Pin de mídia (YouTube/Spotify) em `high`/`critical` só vale com áudio. O teto conta
o CRM. `maxLoadedViews` escrito à mão continua valendo como teto: a pressão só
aperta, nunca afrouxa. A mudança de faixa vai para o log (`memória`, com o total
em MB e o orçamento), a permanência não — uma linha por minuto afogaria o
diagnóstico bem na hora de entender por que uma aba fechou sozinha.

**O que isto não resolve:** hibernar é o único jeito de devolver RAM (renderer
vivo e escondido não devolve quase nada), então quem usa uma aba só continua
pagando o preço dela. Com WhatsApp + CRM abertos e nada ocioso, o app fica na
casa dos 2 GB e não há o que apertar sem fechar o que está em uso.

## CI — o gate que nunca passou

Trinta e nove execuções desde 22/07, trinta e nove falhas. Nenhuma delas foi investigada
porque o e-mail de "Run failed" virou paisagem, e porque na máquina de quem programa o
comando passava.

A causa é a ordem: `pnpm typecheck` rodava logo depois do `install`. `dist/` é gitignored,
e cada pacote resolve o irmão pelo `exports` do `package.json`, que aponta para
`./dist/index.d.ts`. No runner, que é sempre um clone limpo, esse arquivo não existe — o
`tsc` para em `TS2307: Cannot find module '@adr/contracts'` já no `@adr/app-state` (o
`crm-core` cairia igual; o pnpm aborta antes de chegar nele).

**Por que ninguém via:** localmente o `dist` sobra de qualquer `pnpm dev` anterior. O
mesmo comando, no mesmo commit, passa aqui e falha lá — e o verde local era lido como
prova de que o vermelho remoto era problema do CI.

Reproduzido movendo `packages/contracts/dist` para fora: o `TS2307` aparece idêntico ao do
runner; com o build antes, o typecheck fecha em zero. Atenção ao repetir o teste: `tsc -p`
com `composite` pula o emit se o `tsconfig.tsbuildinfo` sobreviver — apagar só o `dist`
não basta para reproduzir.

O conserto é uma linha (`pnpm build` antes do `typecheck` no `ci.yml`), e o
`pnpm --filter @adr/desktop build` saiu do fim da lista porque o build da raiz já o cobre,
em ordem topológica.

**A lição que fica:** gate que nunca passou não é gate. Trinta e nove execuções vermelhas
seguidas são indistinguíveis de trinta e nove execuções que ninguém leu — e o custo disso
é que qualquer regressão real desde 22/07 teria entrado sem ninguém notar.

## 0.1.7 — "Instalar" que não instalava

Primeira vez que o caminho de update foi exercitado de ponta a ponta (as 0.1.3 a
0.1.5 foram instaladas na mão, nunca subiram como release). O download da 0.1.6
funcionou — arquivo íntegro em `%LOCALAPPDATA%\@adrdesktop-updater\pending`, sha512
batendo com o `latest.yml` — e o botão **Instalar** não fazia nada.

A causa de fundo é que ninguém ficava sabendo: `quitAndInstall` não devolve valor
e não lança. Ele dispara o instalador e pede `app.quit()`. Se o quit for barrado,
ou se o spawn do instalador falhar no `.catch` assíncrono lá dentro, não sai
sinal nenhum — e a gente respondia "Reiniciando para instalar…" de qualquer jeito.

Três mudanças, nessa ordem de importância:

- **`before-quit` com teto de 3 s.** Aquele handler CANCELA o quit e promete
  recolocá-lo depois de gravar os cookies; com um `flushStore` travado, o app
  simplesmente nunca fechava. Cookie não gravado custa um login, não fechar custa
  o app inteiro.
- **Aviso de instalação travada.** Cinco segundos depois de pedir a instalação, se
  o app ainda estiver vivo, o clique não funcionou: registra no diagnóstico e
  abre o instalador já baixado e validado pelo próprio updater.
- **Fase de erro do updater vai para o log.** A mensagem ao usuário é genérica de
  propósito (`safeUpdaterError` não vaza URL nem token), e sem registrar a fase
  não sobrava rastro nenhum para investigar.

## 0.1.6 — menu de contexto e revisão de código

### Copiar imagem entre conversas

O Electron não tem menu de contexto: sem registrar `context-menu`, botão direito
dentro de qualquer view não fazia nada. Era esse o buraco do "não consigo copiar
uma imagem de uma conversa e colar em outra" — sem "Copiar imagem" não há como
pôr a figura no clipboard, e o Ctrl+V do outro lado cola o nada.

`main/context-menu.ts` monta o menu a partir do que foi clicado: imagem (copiar,
copiar endereço, salvar como), link (copiar, abrir no navegador), campo editável
(recortar/copiar/colar/colar sem formatação/selecionar tudo), seleção (copiar).
Vale nas views de serviço e na do CRM. `copyImageAt` lê o bitmap já decodificado
da própria página, então funciona com os `blob:` do WhatsApp.

Anexo de documento (PDF, zip) continua sem "copiar" — nem o Chrome tem. Ali o
caminho é baixar e reenviar.

### Correções da revisão de código

- **Estado podia sumir no Windows.** `saveAppStateAtomic` fazia `unlink` antes do
  `rename`, abrindo uma janela em que `state.v1.json` não existia. O comentário
  que justificava isso estava errado: `rename` SOBRESCREVE no Windows (libuv usa
  `MoveFileExW` com `MOVEFILE_REPLACE_EXISTING`) — o próprio cofre de senhas já
  dependia disso.
- **Update não instala mais sozinho ao sair.** O pacote não é assinado com
  Authenticode, e sem isso o electron-updater PULA a verificação de assinatura do
  instalador que baixou. Instalar no quit virava execução de código sem nenhum
  clique. Agora exige o botão do banner. Volta a ser automático quando houver
  certificado (ver RELEASE.md).
  *Atualizado em 20/10/2026:* a 0.1.50 (`bee1eba`) voltou a instalar sozinha ao
  sair e com o computador ocioso (`installUpdateWhenIdle`), ainda sem
  Authenticode. A regra de "ocioso" está em `update-policy.ts`
  (`canInstallUpdateNow`).
- **Guarda de subframe do IPC do CRM estava desligada.** `frameIsMain: true` era
  constante, então a trava do `ipc-guard` nunca disparava, e a URL conferida era
  a do frame de topo. Passa `event.senderFrame` de verdade.
- **Destino de download escolhido pelo usuário era ignorado.** O handler de
  `will-download` fazia `await dialog.showSaveDialog(...)` antes de
  `setSavePath`, e quando o `await` voltava o Electron já tinha seguido com o
  padrão. Agora usa `setSaveDialogOptions`.
- **Executável baixado não ganha mais "Abrir" como botão padrão** — some do
  diálogo, que vira aviso. Quem quer rodar abre pela pasta.
- **Sair da conta Google não derruba mais o Spotify.** `clearStorageData()` sem
  filtro limpava a partição inteira, que é dividida com Spotify e ADR Browser.
  Agora remove só cookies de domínio Google/YouTube e storage só das origens
  Google.
- **Hibernar grava o cookie da sessão** antes de fechar a view. Hibernação é o
  caminho mais rodado do app (10 min de inatividade); só `before-quit` e
  `session-end` gravavam.
- **Nome de arquivo seguro no Windows** — `CON`, `NUL`, `COM1`… e ponto/espaço no
  fim, que o Windows remove sozinho e fazia o nome gravado não bater com o
  checado.
- **`compareVersions` entende pré-release** — `0.1.0` agora é maior que
  `0.1.0-spike`. Antes empatavam e quem estava na prerelease nunca via o final.
- **`safeLogLine` não estoura** com payload circular, e `redactSecrets` cobre
  cookie de sessão de terceiro (`sp_dc`, `sp_key`, `SID`/`SAPISID`, `set-cookie`).
- **Horário do não perturbe configurável** (default 19h–8h, como era), tratando
  janela que cruza a meia-noite.
- **Scripts da raiz usam `corepack pnpm`** — `pnpm test` e `pnpm typecheck`
  quebravam em máquina sem `pnpm` no PATH, contrariando o README.
- Exports mortos removidos (`ALLOWED_ORIGINS`, `resolveCrmBaseUrl`,
  `SPIKE_CRM_COMMANDS`).

### Dívida conhecida

`main/workspace-window.ts` tem ~7.200 linhas (eram 2.749 em 03/08/2026), quase
tudo numa closure só, e concentra layout, 82 handlers IPC, ciclo de vida das
views, CRM, cofre/Bitwarden, notificações, downloads, adblock e updates. É o
arquivo de maior risco e não tem cobertura de teste (o `coverage` agora o inclui:
a cobertura real do main é ~41 %). Ver
`docs/reports/code-review/adrworkspace-code-review-geral-2026-10-20.md`. O padrão de extração já existe
(`permission-policy`, `download-policy`, `notifications`, `service-navigation`
são puros e testados) — falta aplicá-lo ao resto, um módulo por commit.

## Melhorias recentes

- Badges de não lidos no rail (título WhatsApp)
- Otimização de memória: CRM lazy (não nasce no boot logado), CRM no LRU, pin de mídia cede sem áudio sob pressão, probe só no campo focado, `closeAllConnections` no hibernate, cache de disco 100 MB. Sem teto de heap V8.
- Clique em notificação foca o WhatsApp certo
- Recovery real (destroi/recria view após crash)
- Banner de update + toast
- Remover/renomear WA, keepAwake, sair do Google compartilhado
- Botão "Limpar" no painel de notificações
- Popup "Abrir / Mostrar na pasta" ao concluir download
- Update grava cookie de toda partição (serviço hibernado não perde login)
- Clique na notificação do WhatsApp abre a conversa (não só o serviço)
- "Limpar" no sino zera também o contador da barra de tarefas, até chegar
  mensagem nova (ler mensagem não traz o número de volta)
- Sino conta notificações não lidas do painel, não mensagens — as mensagens já
  têm badge no ícone de cada serviço
- Gmail com badge de não lidos, item no sino e toast (lido do título da aba;
  só enquanto a aba não hiberna — marque "Manter sempre ativo" para vigiar o dia
  todo). Notificação nativa do Gmail continua sendo opção do próprio Gmail, e
  agora respeita a chave de notificações do app e foca a aba certa no clique
- Canais IPC do shell/toolbar só aceitam as views do próprio app
- Correções: campo em foco não é sobrescrito pelo broadcast; fallback quando o
  navegador externo não abre; progresso de download não repinta o shell a cada
  bloco; badge da barra de tarefas zera ao remover serviço


## Google Contacts (salvar contato do WhatsApp)

Botão "Salvar no Google" no cabeçalho do painel do CRM, injetado pelo app (não
pelo CRX, que vem de outro repositório). Ele abre o formulário de novo contato do
Google **no navegador do usuário, já preenchido** com nome e telefone da conversa
aberta; quem revisa e salva é a pessoa, no próprio Google.

Sem API, sem token, sem projeto no Google Cloud. Os parâmetros do formulário
foram medidos ao vivo e não são documentados pelo Google:

- `givenname` (tudo junto, minúsculo) preenche o Nome — `name`, `given_name`,
  `firstName` e `first_name` são ignorados
- `phone` preenche o Telefone; com `+DDI` o Google acerta o país sozinho
- `authuser` escolhe a conta, para não abrir na errada de quem tem várias

O nome sai da mesma sonda que identifica a conversa, e título que é só número não
vira nome — contato fora da agenda abre só com o telefone. Grupo não tem telefone
único, então o botão avisa em vez de abrir algo torto.

Em Configurações → Perfil há um campo opcional com o e-mail da conta (vira o
`authuser`). Em branco, abre na conta padrão do navegador.

Houve uma primeira versão com OAuth + People API que criava o contato direto,
removida em favor desta. Está em `3f72f99` se o salvamento em um clique fizer
falta um dia. O consentimento OAuth não pode ser feito em user agent incorporado,
independentemente de a conta ser pessoal ou Google Workspace; em modo Testing,
refresh tokens também podem expirar após 7 dias. O fluxo atual deixa o usuário
revisar e salvar o contato no navegador externo.

## Bloqueios humanos (não automatizáveis aqui)

- R6 chave privada da extensão no cofre (se ainda não arquivada)
- Soak 8h / smoke Ubuntu limpo / piloto interno
- Publicar tags/releases no GitHub quando for beta/stable

## Repositório

https://github.com/ADRAGENCIACRM/adrworkspace

Update check: `ADR_UPDATE_REPO=ADRAGENCIACRM/adrworkspace`

## Artefatos beta

- GitHub prerelease `v0.1.0-spike`
- `adr-workspace_0.1.0-spike_amd64.deb`
- `adr-workspace_0.1.0-spike_x86_64.AppImage`

Ver também: `docs/RELEASE.md`
