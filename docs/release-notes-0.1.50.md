# ADR Workspace 0.1.50

TikTok e Google Meet no catálogo, login Google reaproveitando as contas do
workspace (ChatGPT, Claude, Notion, Trello, TikTok), lembrete de reunião pela
agenda, registro de reunião no CRM, backup do perfil e permissões revisáveis.
As seções abaixo seguem as candidatas testadas (rc.1 a rc.6), da mais nova para
a mais antiga.

## Atualizar

Pela atualização automática (Configurações → Sobre → Buscar atualizações), ou
com o instalador por cima da versão atual — as sessões continuam logadas e o
instalador copia o perfil antes (ver "Instalar preservando as sessões").

## Novo na rc.6 (pendências das revisões da rc.5)

- **Clique na notificação do WhatsApp:** "Não foi possível localizar a conversa
  desta notificação" aparecia com frequência sem motivo. Contato com "|" no
  próprio nome ("Fulana | ADR Agência") nunca era achado (o nome era cortado no
  "|"), e a confirmação dependia de um detalhe do cabeçalho do WhatsApp que mudou.
  Agora procura pelo nome inteiro, confirma pelo texto do cabeçalho e não acusa
  erro quando já clicou na conversa certa.
- **Configurações → Notificações:** com a janela estreita ou zoom alto, o botão
  "Remover" do lembrete da agenda saía da tela; agora a linha quebra.
- **Meet com a aba travada:** a chamada agora termina depois de 1 min sem
  resposta da página. Antes, uma aba travada de vez deixava o "não perturbe",
  o atalho do microfone e a mini-janela presos (as falhas paravam de contar).
- **Agenda:** a mesma agenda não é reprocessada a cada 5 min (reaproveita a
  leitura por até 1 h; agenda alterada é lida na hora). Mensagens de erro dizem
  o intervalo real de nova tentativa.
- **Menus de escolha** (conta Google, negócio do CRM, tela a compartilhar)
  passam por um só componente, com o mesmo cuidado de "fechou sem escolher".
- Código: lembrete da agenda (`calendar-scheduler.ts`) e hibernação
  (`hibernation.ts`) saíram para módulos testados sem Electron;
  `popup-choice.ts`; comentários restantes em português.
- Testes: 469 no desktop (novos para agenda, hibernação, menus, chamada do
  Meet e painel do WhatsApp com "Mais ▾"); cobertura medida de 36% para 78%
  das linhas (sem `workspace-window.ts`/`index.ts`, testados por outro
  caminho); testes de E/S do estado sem esperas reais.

## Novo na rc.5

- **Mini-janela do Meet com controles próprios:** barra no topo com "Abrir"
  (volta para a reunião) e "✕" (oculta nesta reunião).
- **Escolha da conta Google pelo e-mail:** com mais de uma conta Google no
  workspace, o menu mostra os e-mails logados em cada uma, e "Outra conta…" abre
  a tela de adicionar conta no Gmail do workspace (o caminho que o Google aceita).
- **Registro de reunião no CRM:** depois do contato, escolha o negócio (abertos
  primeiro) e escreva uma anotação opcional.
- **Agenda nas Configurações:** mostra a próxima reunião com Meet (próximas 24 h)
  e a hora da última leitura; erros explicados ("use o endereço SECRETO").
- **Painel do CRM no WhatsApp mais enxuto:** "Salvar no Google" à vista; vincular
  a negócio/empresa e agendar reunião no menu "Mais ▾".
- **Resultado do backup:** ao reabrir depois de um backup, aviso com o tamanho
  (ou o motivo da falha).
- **Login recusado pelo Google:** em vez da página crua, o app explica o que
  fazer e oferece abrir o serviço no navegador.
- **Menos trabalho na interface:** as telas recebem só o que mudou no estado.
- Código: permissões e Configurações (agenda, permissões, backup) saíram do
  `workspace-window.ts` para módulos testados; cobertura de testes medida
  (`corepack pnpm --filter @adr/desktop run coverage`).

### Corrigido pelas 3 revisões da rc.5

- **CRM:** a reunião só oferece negócios da empresa do contato (principal ou
  segunda) e manda a empresa junto — antes, negócio de outra empresa dava erro
  400 e a reunião vinculada não aparecia na ficha da empresa.
- **Anotação da reunião:** botão "Registrar" (era "Buscar"), em branco registra
  sem anotação, e "Cancelar" agora cancela o registro.
- **Menu "Mais ▾":** fecha depois de escolher, fecha com Esc e não é mais cortado
  pela borda do painel.
- **Escolha de conta Google:** clique duplo em "Continuar com o Google" não
  quebra mais o login; e-mails ficam guardados por 60 s; o menu não aparece se
  você já trocou de aba.
- **Recusa do Google nas abas Google** (Gmail, Agenda…): texto próprio, sem o
  circular "entre pelo Gmail".
- **Status da agenda** no painel atualiza a cada leitura (antes ficava em
  "Verificando a agenda…" até outra coisa mudar).
- **Backup:** se o app não fecha em 30 s (aviso aberto), a falha agora aparece
  ao reabrir; texto do aviso limitado.
- **Telas recarregadas** não ficam mais com valor velho do estado.
- **Segurança:** links da janela de login do Google só abrem no navegador com a
  janela em foco (um por vez); a barra da mini-janela não navega para fora.
- **Testes:** 427 no desktop (novos: `permission-handler.test.ts`,
  `profile-ipc.test.ts`); cobertura sem `workspace-window.ts`/`index.ts`
  (testados por outro caminho, não medem).

## Novo na rc.4 (3 revisões: fluxos de uso, ciclo de vida, testes)

- A agenda do lembrete é lida fora da janela (worker): agendas grandes travavam o
  app por segundos a cada 5 min.
- A atualização automática só instala com o computador parado há 5 min — não
  mais ao minimizar, quando reabria maximizada por cima do seu trabalho.
- Registrar reunião no CRM: busca sem resultado reabre o campo; contato sem
  empresa explica o motivo; também pelo botão direito no Meet ("Registrar a
  última reunião no CRM…"), sem depender do aviso do Windows.
- Links e lembretes do Meet abrem na aba do Meet de qualquer workspace.
- Backups do perfil vão para %LOCALAPPDATA% (não sincronizam em perfil móvel);
  abrir o app no meio de um backup pergunta antes; backup que falhou é avisado.
- "Agendar reunião" acha o e-mail do contato no CRM (telefone só com dígitos).
- Revogar microfone ou câmera revoga também a permissão antiga combinada.
- Lembrete atrasado por suspensão do computador é descartado; a agenda é relida
  ao acordar. Agenda que não abre neste computador avisa para colar de novo.
- Cancelar a escolha de conta Google recarrega a página do serviço (o botão não
  fica girando).

## Novo na rc.3

- **Reuniões do Meet sem interrupção:** durante a chamada, WhatsApp e Gmail ficam
  calados; **Ctrl+Alt+M** liga/desliga o microfone de qualquer lugar; trocar de
  serviço no meio da reunião deixa uma **mini-janela** da chamada no canto.
- **Lembrete de reunião:** cole o "Endereço secreto no formato iCal" do Google
  Calendar em Configurações → Notificações; antes de cada reunião com Meet chega
  um aviso, e clicar nele entra na sala.
- **Agendar reunião** no painel do CRM do WhatsApp: abre o Google Calendar com o
  evento já preenchido (contato e sala do Meet).
- **Registrar a reunião no CRM:** ao sair de uma reunião de 2 min ou mais, um
  aviso oferece registrar no contato (atividade "reunião" concluída).
- **WhatsApp e Gmail sempre ativos** (padrão): não hibernam por ociosidade, para
  não perder aviso nem contador. Desligável em Notificações.
- **Permissões dadas a sites** em Privacidade, com "Revogar".
- **Backup do perfil:** cópia automática a cada instalação/atualização (as 3
  últimas) e "Fazer backup agora" em Configurações → Geral.
- **Login com Google:** com mais de uma conta Google no workspace, o app
  pergunta qual usar.
- **Assinatura de código gratuita** (certificado próprio) para os computadores
  da equipe: ver `docs/ASSINATURA.md`.

## Desde a 0.1.49

- **Login com Google no ChatGPT, Claude, Notion, Trello e TikTok usa as contas
  do Gmail.** "Continuar com o Google" abre uma janela "Entrar com o Google" já
  com as contas logadas no workspace; escolha a conta e o login termina na aba do
  serviço. Antes o Google recusava com "navegador não compatível".
- **Google Meet** disponível em **Adicionar serviço**, com a conta Google do
  workspace. "Apresentar agora" mostra um menu para escolher a tela ou uma janela. Links de reunião no Calendar, Gmail, WhatsApp
  e CRM abrem na aba do Meet; durante a reunião a aba não hiberna e a atualização
  espera.
- **TikTok** disponível em **Adicionar serviço**, com sessão própria por conta.
- A atualização automática não reinicia mais o app no meio do uso: instala quando
  ele estiver minimizado ou parado, sem chamada, vídeo ou download em andamento —
  ou quando você fechar o app.
- Correções de estabilidade: CRM que ficava preto depois de a aba morrer, abas que
  se fechavam em laço, WhatsApp redirecionado em laço, contador de "Limpar
  notificações" que voltava após fechar o app logo em seguida, e o arquivo de
  configuração preso por antivírus.
- Segurança: janelas abertas por páginas só a partir da aba da frente e com o
  domínio no título; notificações sem pergunta só do próprio serviço; microfone e
  câmera autorizados separadamente (o que já estava permitido continua valendo);
  downloads perigosos (`.rdp`, `.library-ms`, Office com macro) não abrem com
  Enter; o aviso do WhatsApp com PIN não mostra o texto da mensagem.

## Instalar preservando as sessões

Use o `instalar-com-backup.cmd` da pasta de teste (mesma pasta do instalador). Ele fecha o app pelo
caminho normal (que grava os logins), copia `%APPDATA%\ADR Workspace` para
`%LOCALAPPDATA%\ADR Workspace Backups\antes-<versão>-<data>` e só então roda o
instalador por cima da instalação atual. Mesma pasta, mesmo `appId`, mesmo
perfil: WhatsApp, Gmail, CRM e demais sessões continuam logados.

Instalando à mão: feche o ADR Workspace pelo X da janela (não pelo Gerenciador de
Tarefas) e execute `ADR-Workspace-Setup-0.1.50.exe`. Não desinstale.

## Limites conhecidos

- Voltar para a 0.1.49 depois de adicionar o TikTok ou o Meet faz a 0.1.49 recomeçar do
  zero (ela não conhece o tipo). Esta versão em diante tolera isso; para voltar,
  restaure o backup do perfil com o app fechado.
- "Manter WhatsApp e Gmail sempre ativos" vem ligado: usa mais memória. Em
  pressão crítica de RAM eles ainda hibernam (e aí não notificam até reabrir).
- A cópia automática do perfil acontece durante a instalação: numa atualização
  silenciosa o app demora alguns segundos a mais para reabrir.
- Assinatura gratuita só é confiável nos computadores onde o certificado foi
  instalado (ver `docs/ASSINATURA.md`).
