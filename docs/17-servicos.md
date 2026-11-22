# Refinamento 17 — Serviços

Presets WhatsApp, Gmail, Calendar, Drive, Notion, Trello, ChatGPT, Claude, Gemini, YouTube, Spotify,
Instagram, TikTok, Google Meet e ADR Browser com URL, perfil e adaptador esperados. Cada conta Trello
recebe uma partição persistente própria (`persist:browser-*`); adicionar ou
duplicar Trello não reutiliza cookies do Google, do CRM nem de outro Trello.
Links e login Atlassian continuam na view do serviço; o menu de contexto oferece
abrir no navegador externo quando a autenticação do provedor não aceitar o
navegador embutido. Esta integração abre o Trello web, sem pedir tokens da API
ou sincronizar cartões com o CRM.

O ChatGPT abre `https://chatgpt.com/` em um serviço web com perfil persistente
próprio (`persist:browser-*`). Cada conta adicionada ou duplicada mantém login
separado do Google, CRM e dos outros serviços. A autenticação acontece no próprio
site; o Workspace não solicita chave de API nem lê conversas para o CRM.

O Claude abre `https://claude.ai/` com o mesmo modelo do ChatGPT: perfil
persistente próprio por conta, duplicável em nova sessão, sem chave de API.

O TikTok abre `https://www.tiktok.com/` com o mesmo modelo: login próprio,
perfil `persist:browser-*` por conta, duplicável. Conta como serviço de mídia
para a hibernação (`isMediaKind`): com "manter sempre ativo" e RAM sob pressão,
só fica acordado enquanto toca som. Não nasce "sempre ativo" (é pesado).

### Google Meet (0.1.50)

O Meet abre `https://meet.google.com/` na **sessão Google do workspace**, como
Gmail e Calendar: entra com a conta já logada, sem novo login. "Outra conta
Google" cria sessão separada, como nos demais serviços Google.

- **Câmera e microfone:** pedidos na primeira reunião e lembrados por tipo
  (`media:audio`, `media:video`). Tela cheia, saída de som e "manter a tela
  acesa" (`screen-wake-lock`) são liberados para os serviços de mídia.
- **Apresentar a tela:** o Electron recusa `getDisplayMedia` sem
  `setDisplayMediaRequestHandler`, e o Windows não tem seletor nativo. O app
  mostra um menu com as telas e as janelas abertas (`screenShareChoices` em
  `meet.ts`). Só a aba da frente com a janela em foco, e só serviços de mídia;
  fechar o menu sem escolher recusa (`callback(null)` — `{}` lança no Electron
  44). O pedido "media" sem tipo que o Chromium faz antes do seletor não pergunta
  "microfone/câmera?" nem grava permissão: quem consente é o seletor. Não há
  "som do computador": o loopback do Windows capturaria as vozes da própria
  reunião e as devolveria como eco.
- **Links de reunião:** um link `meet.google.com` aberto por uma página
  (convite no Calendar, Gmail, WhatsApp, CRM) vai para a aba do Meet do
  workspace em vez do navegador externo, onde a pessoa caía no login. Já numa
  reunião, o app pergunta antes de trocar (continuar, trocar ou abrir no
  navegador). Sem aba do Meet no workspace, o link segue para fora como antes;
  "Abrir no navegador" do menu de contexto continua indo para fora.
- **Reunião não se interrompe:** estando NA chamada, a aba não hiberna (nem
  minimizada), não é estrangulada em segundo plano mesmo com todos calados, e a
  atualização automática espera a reunião acabar. "Na chamada" é a sala
  (`xxx-xxxx-xxx`, `isMeetCallUrl`) + o botão "Sair da chamada" na página
  (`MEET_IN_CALL_PROBE`, sondado a cada 10 s e antes de hibernar): a tela
  "Pronto para participar?" e a de "você saiu" ficam no mesmo endereço e não
  seguram nada. Sala ainda não sondada conta como reunião.
- Convite do Meet aberto como janela (`window.open` com tamanho) também vai para
  a aba do Meet.
- **Durante a chamada (0.1.50-rc.3, `meet-integration.ts`):** WhatsApp e Gmail
  ficam calados (preferência "Silenciar avisos durante reuniões"); Ctrl+Alt+M
  liga/desliga o microfone de qualquer lugar (registrado só enquanto há chamada);
  trocar de serviço — ou de workspace — deixa a chamada numa mini-janela no canto
  inferior esquerdo (o direito tem o botão de enviar e o painel do CRM; menu de
  contexto do Meet: "Ocultar mini-janela desta reunião"; desde a rc.5 a própria
  mini-janela tem uma barra com "Abrir" e "✕" — `mini-bar.html`, IPC
  `mini:action` só dessa view). Ao sair de uma reunião
  de 2 min ou mais, um aviso oferece registrar a reunião no CRM do workspace da
  aba do Meet (busca o contato; a atividade exige empresa, principal ou a segunda;
  depois, um negócio do contato — só os da empresa dele, que o CRM aceita — e uma
  anotação opcional; "Cancelar" na anotação desiste do registro).
  Gmail por service worker também fica calado na chamada (no check de
  permissão). Aba do Meet travada: 3 sondas sem resposta encerram a chamada.
- **Lembrete só do que você aceitou:** convites recusados ou sem resposta não
  geram lembrete (o iCal secreto traz também convites de desconhecidos), e o
  aviso mostra o organizador.
- **Lembrete de reunião:** com o "Endereço secreto no formato iCal" do Google
  Calendar (Notificações), o app lê a agenda a cada 5 min e avisa N minutos antes
  de cada reunião com link do Meet; clicar no aviso entra na sala.
- **Agendar reunião** (painel do CRM no WhatsApp): evento do Calendar já
  preenchido com o contato e sala do Meet, aberto na aba do Calendar.

O Gemini abre `https://gemini.google.com/app` na sessão Google do workspace,
como Drive e YouTube: entra com a conta já logada no Gmail, um por workspace, e
"outra conta Google" cria sessão separada. Sair da conta Google também limpa a
origem do Gemini.

### "Continuar com o Google" usa as contas Google já logadas (0.1.50)

Na partição isolada do serviço não há conta Google, e o Google respondia
`accounts.google.com/v3/signin/rejected` ("o navegador não é compatível") ao
login OAuth vindo de um navegador embutido sem sessão. Desde a 0.1.50 o app
intercepta, na aba (e no popup de login dela), a navegação para o OAuth do Google
(`googleOAuthRedirectUri` em `chrome-session.ts`) e roda essa etapa numa janela
"Entrar com o Google — <site>" na **partição Google do workspace** — a mesma do
Gmail, com as contas já logadas e o seletor de conta pronto. Quando o Google
devolve para o `redirect_uri`, o app cancela essa navegação e carrega o retorno
(com `code`/`state`) na aba do serviço, que tem os cookies de estado e conclui
o login lá. Nenhum cookie é copiado entre partições.

Fica no fluxo antigo (dentro da aba) quando: o workspace não tem sessão Google; o
`redirect_uri` não é de um site do serviço (`isServiceOAuthRedirect`: ChatGPT →
openai.com/chatgpt.com, Claude → claude.ai/anthropic.com, Notion →
notion.so/notion.com, Trello → trello.com/atlassian.com, TikTok → tiktok.com); a
aba não está na frente; `prompt=none` (reautenticação silenciosa); ou
`response_mode=form_post` (o code viria no corpo de um POST). Clicar de novo
reinicia o fluxo com o state novo. A aba não hiberna com a janela aberta, e fechar a
janela cancela (o popup de login, se houver, fecha junto). Fluxos `postmessage`
(Google Identity Services) não passam por aqui.

Com mais de uma conta Google no workspace, um menu pergunta qual usar, mostrando
os e-mails logados em cada sessão (`ListAccounts`, o mesmo endpoint que o Chrome
usa, chamado com os cookies daquela partição; só para o menu, nada é gravado).
"Outra conta…" abre `accounts.google.com/AddSession` na aba do Gmail do
workspace: o login direto do Gmail o Google aceita, e a conta passa a aparecer na
lista. Uma partição nova e vazia cairia na mesma recusa. Quando o Google recusa
(`signin/rejected`), o app explica as saídas e oferece abrir o serviço no
navegador (no máximo um aviso a cada 10 min por serviço). Na janela,
o título mostra o site atual quando a página sai do Google (SSO de empresa).
"Usar outra conta" dentro da janela adiciona a conta à sessão Google escolhida
(Gmail, YouTube, Spotify, ADR Browser).

### Login social em janela própria

Login social dos serviços com conta própria (Notion, Trello, ChatGPT, Claude e TikTok):
"Continuar com Google/Apple/Microsoft" abre uma janela de login de verdade, filha
da janela do app e na mesma sessão da aba, como no Chrome. O popup OAuth devolve o
resultado por `window.opener` e se fecha com `window.close()`; carregado dentro
da aba, o login parava na tela do Google e o `close` fechava a própria aba
(erro "reading 'setZoomFactor'" na 0.1.47-rc.1). A janela de login fecha junto com
a aba que a abriu. A lista desses serviços é uma só (`STANDALONE_LOGIN_KINDS` em
`@adr/service-adapters`): duplicar abre outra conta e o serviço pode ser renomeado,
inclusive o Notion.

Desde a 0.1.48 a regra vale para **todo serviço e todo site**, sem lista: página
que pede uma JANELA (`window.open` com tamanho, que o Chromium marca `new-window`)
ganha uma janela de verdade. Desde a 0.1.50 só a aba da frente, com a janela do
app em foco, abre essa janela (no máximo uma a cada 1,5 s), e o título da janela
mostra o domínio da página, já que ela não tem barra de endereço. É assim que funcionam login social, pagamento e
consentimento em qualquer site, como o "Continuar com o Google" do LinkedIn no ADR
Browser, que antes ficava em branco dentro da aba. Link com `target=_blank`
continua abrindo na própria aba, e o WhatsApp continua mandando links ao navegador
externo.

**Links para outro site abrem no navegador padrão** (Configurações → Geral →
Navegador externo). Um link "em nova aba" no ChatGPT, Claude, Gmail, Instagram
etc. carregava dentro da aba do serviço e o usuário perdia a conversa ou o e-mail.
Continuam na aba os links do próprio site (`siteOf`: domínio registrável; no
google.com cada app é um site, então Calendar → Meet sai), as páginas de login e
tudo no ADR Browser, que é o navegador do app. Redirecionadores (`google.com/url`,
`l.instagram.com`, `l.facebook.com`) são desembrulhados e o destino real é aberto.

Uma aba cuja página se fecha sozinha é tirada do app na hora e recriada ao ser
aberta de novo, em vez de derrubar o processo principal. O ADR Browser volta à
página inicial dele (a página que se fechou se fecharia de novo), e uma segunda
autodestruição em 15 s não recria mais: o app avisa e volta para Configurações.

Nenhum dos serviços de IA nasce "sempre ativo": ociosos, hibernam como os demais e
devolvem a RAM. Claude e Gemini podem pedir microfone para o modo de voz.

### Faixa de abas do ADR Browser

No ADR Browser, acima da barra de endereço (abaixo dela quando a barra está
embaixo), fica uma faixa de abas como a do Chrome/Edge: ícone do site, título,
✕, botão "+", arrastar para reordenar, botão do meio fecha, duplo clique no
vazio abre aba nova. Atalhos: Ctrl+T (nova aba, em qualquer tela), Ctrl+W
(fecha a aba; só com uma aba do ADR Browser na frente — nunca fecha WhatsApp
ou Gmail), Ctrl+Tab / Ctrl+Shift+Tab (próxima/anterior, dando a volta),
Ctrl+Shift+T (reabre a última fechada).

**Decisão: as abas SÃO os serviços `browser` do workspace atual**, na ordem da
barra lateral. Não existe uma segunda lista: a faixa é um espelho que o main
manda (`browser:tabs`) e cada gesto dela vira o mesmo caminho da lateral —
nova aba é `addServiceToWorkspace("browser")` (por `openUrlInBrowserTab`, o mesmo
caminho de link em nova aba e de aba duplicada), fechar é `removeServiceById` (o que alimenta o
Ctrl+Shift+T), reordenar é `reorderWorkspaceRail`. Assim lateral e faixa nunca
divergem, hibernação, partição e restauração continuam valendo por aba, e uma
aba fechada pela lateral some da faixa (e vice-versa) sem código de sincronia.

- Ao fechar a aba da frente, ativa a da direita (ou a da esquerda, se era a
  última), como no Chrome (`tabAfterClose`); sem abas sobrando, vale a regra de
  sempre (primeiro serviço da lateral).
- Reordenar só troca as abas de lugar entre si: as posições da lateral que eram
  de abas recebem a nova ordem, e WhatsApp, Gmail, CRM etc. não se mexem
  (`mergeTabOrderIntoRail`). Fixadas continuam antes das demais.
- O título é o da página; aba hibernada mostra o último título conhecido ou o
  domínio (`tabTitle`). O ícone é o mesmo `page-favicon-updated` da barra.
- A faixa mora na mesma view da barra de endereço (sem renderer novo): o main
  dá 36 px a mais de altura só para serviços `browser`, e a página da barra
  mostra a faixa por media query de altura. Instagram e Google fora do site
  têm barra de endereço, mas não faixa — não são abas do navegador.

Lógica pura em `apps/desktop/src/main/browser-tabs.ts` (testes em
`browser-tabs.test.ts`).

### Histórico e restauração das abas do ADR Browser

O ADR Browser guarda o histórico de navegação e o endereço de cada aba aberta,
para o `Ctrl+H` (janela de histórico com busca, remover item e "Limpar
histórico") e para reabrir o app com as abas onde estavam. Só abas do ADR
Browser; os outros serviços continuam sem histórico.

- **Criptografado** pelo sistema (DPAPI, como o Cofre ADR) em
  `userData/history/browser-history.v1.json`. Sem criptografia disponível, fica
  só em memória — nunca em texto puro no disco.
- **Nunca entram** páginas de login (contas Google/Microsoft/Apple/Atlassian/
  OpenAI/xAI, subdomínios `login.`/`auth.`/`sso.`/`accounts.`, caminhos
  `/login`, `/oauth`, `/authorize`) nem endereços com credencial na query ou no
  fragmento (`code`, `token`, `access_token`, `id_token`, `state`, `key`…).
  Uma aba que passa por login continua salva na última página comum.
- **90 dias**, até 5.000 endereços (uma entrada por endereço, com contagem de
  visitas). Fechar a aba tira ela da restauração (o `Ctrl+Shift+T` segue só em
  memória). Limpar o histórico não fecha nem esquece as abas abertas.

Lógica em `apps/desktop/src/main/browser-history.ts` (testes em
`browser-history.test.ts`); janela em `shell/history.html`.
