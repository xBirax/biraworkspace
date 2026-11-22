# ADR Workspace

Monorepo do aplicativo desktop ADR Workspace (Electron), conforme `PLANO_MESTRE_ADR_WORKSPACE.md`.

## Pré-requisitos

- Node.js ≥ 22
- pnpm 9.15.9 via Corepack (`corepack pnpm` — use este comando se `pnpm` não estiver no PATH)

## Clone limpo

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Rodar (dev)

```bash
corepack pnpm install
corepack pnpm dev
```

Funciona em **Windows**, macOS e Linux. Pacotes de release (`.deb` / AppImage) continuam só Linux.

## Estrutura

```text
apps/desktop
packages/contracts
packages/crm-core
packages/crm-chrome-adapter
packages/crm-desktop-adapter
packages/service-adapters
packages/app-state
packages/partitions
packages/view-lifecycle
packages/workspaces
docs
scripts
vendor/adr-crm-extension-0.15.5
```

## Release e atualização

Empacotar Windows, publicar e atualizar por dentro do app: `docs/RELEASE.md`.
No app: Configurações → Sobre → **Buscar atualizações** → **Instalar**.

## Navegação

Em Configurações → Geral, **Navegador externo** permite escolher o padrão do
sistema, Chrome ou Brave. Novas instalações usam o padrão do sistema; escolhas
já salvas são preservadas. Se um navegador escolhido explicitamente não abrir,
o app informa a falha sem substituí-lo por outro.

Ao hibernar o ADR Browser, o app mantém a URL e o histórico de navegação em memória
para restaurar a aba. Não grava esse histórico nem o conteúdo de formulários no
arquivo de estado. Isso não equivale a restaurar rascunhos não salvos após fechar o app.
O CRM só carrega quando a aba é aberta; sessão já autenticada no boot vai direto ao
primeiro serviço.

## Links

Links para outros sites, clicados no ChatGPT, Claude, Gmail, Instagram e demais
serviços, abrem no navegador escolhido em Configurações → Geral (padrão do
sistema, Chrome ou Brave). Links do próprio serviço, telas de login e o ADR
Browser continuam dentro do app.

## Google Meet

O Meet usa a conta Google do workspace. Links de reunião clicados no Calendar,
Gmail, WhatsApp ou CRM abrem na aba do Meet (se o workspace tiver uma); durante a
reunião a aba não hiberna e a atualização do app espera. "Apresentar agora" mostra
um menu para escolher a tela ou a janela.

Durante a reunião: WhatsApp e Gmail ficam calados, **Ctrl+Alt+M** liga/desliga o
microfone e, ao trocar de serviço, a chamada fica numa mini-janela no canto. Com o
endereço iCal do Google Calendar (Configurações → Notificações), o app avisa antes
de cada reunião com Meet. No painel do WhatsApp, **Agendar reunião** abre o Calendar
com o evento preenchido; ao sair de uma reunião, o app oferece registrá-la no CRM.

## Testes e cobertura

```bash
corepack pnpm test
corepack pnpm --filter @adr/desktop run coverage
```

O segundo gera `apps/desktop/coverage/index.html` (processo principal).

## Backup e permissões

Cada instalação ou atualização copia o perfil (logins e configurações) para
`%LOCALAPPDATA%\ADR Workspace Backups` antes de abrir a versão nova (ficam as 3 últimas).
Configurações → Geral → **Fazer backup agora** fecha o app, copia e reabre.
Configurações → Privacidade lista as permissões dadas a sites, com "Revogar".

## Assinatura de código

Ver `docs/ASSINATURA.md`: certificado próprio gratuito para os computadores da
equipe, e as opções pagas que fazem qualquer Windows confiar no instalador.

## Login com Google nos serviços de conta própria

ChatGPT, Claude, Notion, Trello e TikTok têm sessão própria, sem conta Google.
"Continuar com o Google" neles abre a janela **Entrar com o Google**, que usa as
contas já logadas no Gmail do workspace; depois de escolher a conta, o login
termina na aba do serviço. Sem Gmail/Google no workspace, o login segue dentro da
aba, como antes.

## Notificações

Ao clicar no aviso do WhatsApp, o app traz a sessão correta para frente e abre a
conversa indicada. Se essa sessão estiver protegida, pede o PIN antes de abrir a
conversa. Notificações do CRM ficam bloqueadas, inclusive as de segundo plano.

O botão direito em um WhatsApp ou no Gmail oferece **Limpar notificações**: o
contador da barra lateral e da barra de tarefas some e só volta quando chega uma
mensagem ou e-mail depois disso. Ler mensagens antigas não faz o contador voltar,
e a escolha continua depois de reiniciar o app.

## Privacidade

O timeout do PIN considera atividade de teclado/mouse enquanto o app está em foco,
não apenas a visibilidade da aba. A retomada da janela também verifica a expiração.
O cache de transcrições é isolado por workspace e identidade CRM; sua leitura e
escrita exigem sessão válida e são invalidadas no logout/troca de credenciais.

Configurações → Privacidade permite configurar bloqueio local por PIN de 4 a 12
dígitos para cada sessão individual do WhatsApp. Cada sessão possui cofre próprio
cifrado pelo Electron `safeStorage` (`vault/whatsapp-lock.<id>.v1.json`), fora de
`state.v1.json`. É possível definir se o PIN deve ser exigido apenas ao abrir o app
ou toda vez que o usuário retornar para a aba daquela sessão (relock on leave).
Cada conta protegida possui seu próprio tempo de inatividade para bloqueio automático
(padrão 30 minutos, opções rápidas de 5 min a 2 horas, personalização livre em minutos
ou “Nunca”). A opção “Sempre pedir o PIN ao abrir esta aba” também é individual. É
possível bloquear sessões diretamente pelo menu de contexto na barra lateral. Após
cinco tentativas incorretas consecutivas, a sessão fica bloqueada por 30 segundos; cada
novo bloqueio seguido dobra a espera (1, 2, 4, 8 min), até 15 minutos. A contagem vale
para desbloquear, desativar e trocar o PIN, sobrevive ao reinício do app
(`vault/whatsapp-pin-attempts.v1.json`), é esquecida depois de 24 horas sem erro e zera
quando o PIN da sessão é criado, trocado ou apagado.

Se o cofre de uma sessão sumir ou corromper, o app oferece recuperação por confirmação
explícita para desativar a proteção daquela sessão sem afetar as demais. Com a
criptografia do sistema indisponível (chaveiro travado), a recuperação não é oferecida:
o PIN pode estar íntegro.

Instalações antigas com o PIN único global (`vault/whatsapp-lock.v1.json`) são migradas
uma vez para um cofre por sessão, com o mesmo PIN, e o arquivo global é removido.

## Lusha no ADR Browser

Para consultar um perfil do LinkedIn pela API da Lusha, configure a integração em
`Admin > Integrações` no CRM e entre no CRM pelo Workspace. Abra o perfil no ADR
Browser e use o botão `L`; o resultado e os dados revelados são exibidos diretamente
em card flutuante integrado no navegador com botões de cópia individual por campo,
botão de cópia geral e texto selecionável, sem diálogos nativos do sistema operacional.
A chave permanece criptografada no CRM e não é embutida no instalador. O fluxo não faz
scraping de listas, conexões ou mensagens.
Detalhes e limites estão em [`docs/LUSHA.md`](docs/LUSHA.md).
O Workspace abre pelo CRM e mantém as demais superfícies bloqueadas até a sessão
do workspace estar autenticada.

## Gates

```bash
corepack pnpm verify:r01
corepack pnpm verify:r02
corepack pnpm verify:r03
```
