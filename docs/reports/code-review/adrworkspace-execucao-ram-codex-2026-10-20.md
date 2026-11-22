# ADR Workspace — execução do backlog de RAM no Codex

Data: 20/10/2026. Branch: `fix/code-review-2026-10-20`. Referência anterior: commit `853b91c`.
O usuário autorizou executar o backlog após a validação inicial. As alterações ficaram locais,
sem push, PR, release ou instalação sobre o perfil real.

## Estado dos 11 itens

| Item do handoff | Resultado |
|---|---|
| 1. CRM real logado | Medido antes/depois com sessão autenticada, viewport desktop e janela minimizada. Um processo a menos; working set privado total praticamente igual. Método, arquivos e limites em “CRM autenticado”. |
| 2. Padrão dos mensageiros novos | Conferido: Outlook/Teams já nasciam hibernáveis. Corrigidos os caminhos de criação que deixavam WhatsApp/Gmail hibernáveis. Preferências existentes e migração única preservadas. |
| 3. Sonda de formulário | O preload observa edições desde o início da página e guarda referências fracas, sem copiar o texto. Conteúdo editável não modificado deixa de bloquear por existir; campo focado e edição não vazia seguem protegidos. Sem rastreador ou com falha, a sonda continua conservadora. Primeiro bloqueio registrado uma vez por view. |
| 4. Barra auxiliar | Criada sob demanda e destruída quando nenhum serviço carregado precisar dela. Reabertura cria outra view com navegação, IPC e atalhos registrados novamente. |
| 5. Título e lateral | Um WebContentsView com a lateral e o cabeçalho. As páginas dos serviços cobrem o centro. Removida a página separada de título; a lateral se recolhe se faltar espaço para o conteúdo. |
| 6. Adblock | Escopo mantido, como recomendado. Retirar o bloqueio não foi tratado como economia de RAM comprovada. |
| 7. Console | Listener registrado apenas no WhatsApp e nos tipos com preload do tradutor/Gmail. Benefício principalmente de processamento, sem atribuição isolada de MiB. |
| 8. Métrica da pressão | Política mantida. Novo `windows-memory.ps1` compara working set, working set privado e commit privado, sem alterar o app. Mudar a métrica exigiria recalibrar os limites. |
| 9. Cache ICS | SHA-256 substitui a retenção do texto completo na expansão. Preservadas a invalidação por conteúdo/dono e a validade de uma hora. |
| 10. Fontes | Mantidas. Não há evidência de ganho relevante de RAM pela simples troca de formato; não foram modificadas nem redistribuídas fontes derivadas. |
| 11. Prazo por serviço | Campo opcional e tolerante a estados antigos/futuros. Menu em Configurações → Serviços, com retorno ao padrão de 10 min. Teto de views, janela minimizada e pressão podem antecipar a hibernação; manter em memória continua prevalecendo conforme a política existente. |

## Validação

- Build, typecheck e lint passaram.
- Na validação inicial, **765 testes passaram**: 611 no desktop, 154 nos demais pacotes.
  Após acrescentar os dois testes de permissões do Teams, build, typecheck e lint passaram
  novamente, com **767 testes**: 613 no desktop e 154 nos demais pacotes.
- O cache da agenda continua coberto pelos testes de reaproveitamento, mudança de conteúdo e expiração.
- Novo teste executa o código do preload com DOM simulado: conteúdo salvo, edição, remoção do campo e texto esvaziado.
- Novas verificações cobrem padrões dos mensageiros, manutenção das escolhas existentes,
  prazo opcional/tolerante e política de ociosidade sob pressão.
- O modo `verify` executou o app real fora da tela, em perfil temporário, sem screenshots:
  36 combinações de largura (375/640/1280), posição (quatro) e escala (1/1,5/2);
  um único renderer para título/lateral; fechamento e recriação da barra; rascunho ainda
  protegido após passar o prazo de um minuto; configuração/rejeição de prazos; foco do prompt.
- A checagem encontrou e corrigiu botões fora da janela com zoom alto e uma tentativa de
  acessar a barra já destruída durante encerramento. Sem mascarar avisos de listeners:
  `kickResize` deixa de enfileirar scripts enquanto a página ainda carrega.
- Aparência, contraste e flash de tema não foram reavaliados por screenshot, conforme a regra
  do projeto. A prova por DOM cobre geometria e foco, não substitui essa observação visual.

## Medição de RAM

Mesma semente de perfil, mesmo roteiro `run`, janela fora da tela, CRM simulado. Uma rodada
antes e uma depois; os serviços usam a rede real nas telas de login. Não são contas reais.
As medições desta continuação não devem ser confundidas com a comparação dos cinco lotes
originais: a referência aqui já inclui aqueles lotes.

| Cenário | Processos antes → depois | Working set antes → depois (MiB) | Diferença observada |
|---|---:|---:|---:|
| Abertura | 8 → 7 | 929 → 844 | −85 (−9,1%) |
| Abrir/fechar Configurações | 9 → 8 | 1.089 → 1.000 | −89 |
| Abrir/cancelar prompt | 9 → 8 | 1.047 → 970 | −77 |
| Três trocas de workspace | 11 → 10 | 1.493 → 1.421 | −72 |
| Cinco serviços abertos, teto 3 | 23 → 22 | 3.915 → 3.840 | −75 |
| Depois de 2min50s, teto 3 | 18 → 17 | 2.692 → 2.613 | −79 (−2,9%) |

No último cenário, páginas carregadas passaram de 9 para 8; commit privado, de 1.262 para
1.237 MiB. A barra auxiliar continuou carregada porque ainda havia serviços que a utilizavam.
Sua destruição na ausência desses serviços foi provada separadamente pelo modo `verify`.

A redução de um processo apareceu em todos os cenários, coerente com a remoção do renderer
separado do título. As diferenças de MiB são amostras, não médias de várias rodadas: no platô,
2,9% fica dentro da variação de ±3–6% registrada no relatório anterior. O resultado estrutural
é mais firme do que a estimativa de economia em MiB; não foi extrapolado para contas logadas.

Arquivos brutos: `D:\Claude\adr-measure-codex\result-codex-before-run.json`,
`result-codex-after-1-run.json` e `result-codex-verify-8-verify.json`.

Amostra adicional do app instalado, somente leitura, às 10:10 de 20/10/2026:

| Métrica do Windows | MiB |
|---|---:|
| Working set somado | 4.781,7 |
| Working set privado | 2.999,5 |
| Commit privado | 3.383,9 |

Foram 19 processos nessa amostra. Ela demonstra a diferença entre as métricas e não atribui
esse consumo ao CRM, nem mede o efeito das alterações locais, que não estavam instaladas.
O campo histórico `privateMB` do roteiro Electron representa commit privado no Windows.

## Pendências com contas reais

Login Google no CRM, Ctrl+K nos editores reais, PIN real do WhatsApp, chamadas de
Meet/Teams/WhatsApp, notificações após hibernação de Outlook/Teams e atualização de um perfil
existente pelo instalador continuam exigindo validação. Nenhuma conta, chamada ou instalador
real foi usado naquela etapa. A continuação abaixo registra os testes posteriores com sessões reais.

Edições em contenteditable são mantidas como sujas até esvaziar/remover o campo ou navegar.
O rastreador não tenta adivinhar se um serviço remoto terminou o salvamento automático.

Reprodução e arquivos de saída: `scripts/measure-ram/README.md`. Pasta das rodadas desta sessão:
`D:\Claude\adr-measure-codex`.

## Continuação com contas reais

O usuário adicionou Outlook/Teams e autorizou reutilizar as sessões conectadas do workspace.
O inspector do main foi habilitado no processo instalado sem reiniciá-lo; as sessões de CRM,
Google e Microsoft foram transferidas para perfis isolados em D: por arquivo protegido pelo
Windows DPAPI para o mesmo usuário. Cookies e conteúdo de mensagens não aparecem neste relatório.
Nenhuma cópia da sessão do WhatsApp foi carregada, e não houve envio de mensagens ou convites.

### CRM autenticado

Mesmo workspace e rota `/insights`, sessão real, resposta 200 de `/api/auth/me` em todas as
leituras, sem campo de senha. Referência: bundle `codex-before` preservado na medição anterior;
alterada: build atual do checkout. Um boot por versão, três leituras espaçadas por oito segundos.
Essas leituras são correlacionadas; não equivalem a três execuções independentes.

Todas as janelas de teste ficaram minimizadas. O Windows zera o viewport nativo nessa condição,
então foi usado `enableDeviceEmulation` com viewport desktop de 1212 × 764 em ambas as versões.
Foi exigido viewport positivo e conteúdo de página antes da captura. As séries iniciais
`before-crm-1`/`after-crm-1`, sem essa condição, foram excluídas da comparação principal.

| Mediana das três leituras | Antes (MiB) | Depois (MiB) |
|---|---:|---:|
| Processos | 9 | 8 |
| Working set somado | 1.354,5 | 1.250,6 |
| Working set privado somado | 294,2 | 293,9 |
| Commit privado somado | 404,7 | 394,6 |
| Working set do renderer principal do CRM | 187,5 | 199,9 |
| Working set privado desse renderer | 71,8 | 83,4 |
| Commit privado desse renderer | 83,1 | 94,8 |

O PID do renderer principal do CRM foi 28468 na referência e 5952 no build alterado. A atribuição
usa `webContents.getOSProcessId()` e os contadores do Windows; não atribui GPU/main ou possíveis
subframes ao CRM. O working set desse renderer variou de 187,4–187,7 MiB antes e 192,1–227,7 MiB
depois, mostrando a variação do carregamento real. O resultado firme continua sendo um processo
a menos. O working set privado total ficou praticamente igual: não há evidência suficiente para
prometer redução de RAM privada em contas reais, nem extrapolar esta tela para todo o uso diário.

Arquivos: `D:\Claude\adr-real-validation-20261020\result-before-crm-viewport-1.json` e
`result-after-crm-viewport-1.json`. Os dados brutos incluem horário, autenticação, viewport, PID
e os três contadores por processo. Não são os números de toda a instância instalada com WhatsApp.

### Outlook, Teams e Gmail

Outlook apresentou a caixa de entrada e a ação de novo email; Teams apresentou o controle da
conta e a navegação de Chat/Calendar. Sem campo de senha, em WebContents da cópia do build atual.
Para carregar as interfaces completas mantendo a janela minimizada, os dois receberam viewport
desktop emulado de 1212 × 716. A preferência “Manter em memória” foi desligada somente na cópia.

Com teto 50, para não antecipar o teste pelo LRU, ambos estavam carregados aos 114 s e
hibernados aos 162 s; os WebContents anteriores foram destruídos. O prazo configurado era o
padrão de 10 min, limitado pela política a 2 min minimizado e verificado a cada minuto.
Ambos reabriram em novos WebContents (Outlook 14 → 16; Teams 15 → 17), com a interface da conta
disponível sem novo login. Isso comprova hibernação e retenção da sessão, não recebimento de
notificações enquanto hibernados. Não foram enviadas mensagens de teste.

Evidências: `full-service-auth.json`, `hibernation-final-full.json` e
`full-service-reopened.json`, na pasta `D:\Claude\adr-real-validation-20261020`.

Gmail abriu o compositor. O rascunho criado para o teste foi descartado, sem envio. A janela
minimizada não recebeu foco de teclado (`isFocused() === false`); por isso Ctrl+K não foi
entregue e não foi marcado como aprovado. Resultado: `gmail-check.json`.

### Aviso de configuração recuperada

O aviso apresentado pelo usuário apontava para o perfil temporário `real-after-1 Dev`.
A semente de teste tinha `activeServiceId: null`, rejeitado pelo schema. Os dois arquivos
recuperados registram exatamente `Expected string, received null` nesse campo. A preparação
foi corrigida para omitir o campo e validar a semente com `appStateV1Schema` antes de abrir.
Não foi necessário alterar o tratamento de recuperação do produto.

O estado do perfil instalado passou pelo schema, e nele não foram encontrados arquivos
`state.v1.json.corrupt-*`. Isso explica os dois avisos desta execução; não prova ausência de
outras falhas históricas. Evidência: `configuration-recovery-check.json`.

### Pendências identificadas antes do teste de chamada

- Naquele momento, ainda faltava ingressar na reunião privada e confirmar proteção da chamada.
  O ingresso foi observado na continuação abaixo; a proteção automática continua pendente.
- Ctrl+K com foco nativo num editor real, fluxo completo do OAuth Google, PIN real do WhatsApp
  (desabilitado neste perfil), notificações reais e atualização pelo instalador.
- Aparência, flash de tema e mini-barra de Meet continuam sem prova visual, conforme a regra
  de não tirar screenshots. Não confundir Teams com a integração específica de mini-barra do Meet.

Não houve push, release, instalação nem mudança de código de produto nesta etapa.

## Continuação: foco, chamada privada e permissões

O usuário autorizou exibir somente a cópia de teste para as operações que exigem foco nativo.
Sem screenshots. Foi possível chegar à sala privada do Teams: o prejoin indicava câmera
desligada e microfone “Nenhum”; após ingressar, havia controle `#hangup-button` e a sonda
`MEDIA_ACTIVE_PROBE` retornou `{ active: true, reason: "media" }`. Não foram enviados convites
nem gravados áudio ou vídeo.

**A proteção automática da chamada continua pendente.** O IPC `shell:hibernate-service`
invocado durante a preparação do teste fecha a view diretamente com causa `manual`; ele não
consulta a sonda como o controlador de ociosidade. Essa chamada encerrou a sala vazia de teste
aos 58 s. Logo, não demonstra falha nem sucesso da proteção automática; é preciso repetir sem
o comando manual. Não foi alterada a política do produto para fazer um verificador passar.

Evidências: `private-call-join.json`, `private-call-protection-start.json` e
`private-call-manual-protection.json`, em `D:\Claude\adr-real-validation-20261020`.

### Aviso de áudio/vídeo negado

A cópia usada nessa tentativa havia recebido handlers temporários que negavam mídia para
impedir captura pela automação. Isso provocou o aviso do Teams que orienta usar o ícone de
câmera do navegador. O usuário apresentou a tela durante o teste. Esse override não foi
aplicado ao perfil instalado; a cópia antiga foi fechada e a atual usa a política normal.

Na consulta posterior do app instalado, `getMediaAccessStatus` retornou `granted` para câmera
e microfone, não havia grants de mídia lembrados para os hosts do Teams e o aviso não estava
ativo. Isso não constitui teste de captura de um dispositivo real. No produto, um pedido de
mídia sem autorização lembrada deve chegar ao diálogo “Permissão”; negar não é lembrado.

Foram acrescentados dois testes para áudio/vídeo de Teams em sessão cujo último handler foi
anexado por Outlook, incluindo uma origem de iframe do calendário. Eles comprovam que o check
não nega o pedido antes do diálogo e que uma resposta de consentimento lembra somente o tipo
solicitado para a origem que pediu. Não substituem consentimento ou teste real de hardware.

Build, typecheck, lint e **767 testes** passaram: 613 desktop e 154 nos pacotes.

### Estado após a interrupção do controle da tela

O usuário escolheu a conta Google e confirmou que a caixa de entrada abriu na nova cópia.
A preparação posterior abriu um compositor e inseriu um marcador local de teste, sem envio.
O tracker de edição indicou alteração e o WebContents recebeu foco nativo. Isso ainda não
comprova Ctrl+K: o atalho não foi entregue nem o diálogo de link observado.

O Esc físico interrompeu o Computer Use. A preparação do compositor já encadeada na mesma
chamada de ferramentas foi executada após esse aviso; as próximas etapas foram interrompidas.
O rascunho temporário pode continuar aberto. Nenhuma ação de tela ou equivalente pelo DOM
deve ser retomada sem autorização explícita do usuário. A confirmação da caixa de entrada
responde à solicitação anterior de login e não revoga a interrupção.

Na retomada, verificar a cópia atual, concluir o atalho, descartar somente o rascunho de teste
e repetir a proteção da chamada pelo timer automático. Minimizar a cópia após as etapas que
exigem foco. Não houve push ou instalação nesta continuação.

## Estado final para transferência ao Claude

Após o usuário autorizar a retomada, **Ctrl+K foi aprovado no Gmail real**: editor focado,
atalho nativo, diálogo “Editar ou inserir link” com os campos “Texto âncora” e “Link”, sem
paleta do ADR. Evidência: `gmail-ctrl-k-real-proof.json`. O diálogo foi fechado e o rascunho
próprio descartado, sem envio. A consulta final confirmou ausência do marcador do rascunho.

A segunda tentativa no Teams manteve a política normal de permissões. O calendário estava
autenticado, mas o flyout “Reunir agora” não respondeu consistentemente à automação; a UIA
retornou `coordinate input geometry is unavailable`. Não foi confirmado novo ingresso em sala.
Logo, **a proteção automática da chamada continua pendente**, sem conclusão de falha do produto.

O usuário pediu transferência ao Claude. Às 11h44 (Brasília), a cópia estava minimizada, sem
chamada nem prejoin ativo e sem rascunho de teste Gmail (`handoff-runtime.json`). Código permanece
local, sem novo commit, push, release ou instalação. A seção 13 do `HANDOFF.md` contém o estado
atual, os caminhos dos helpers, os limites dos testes e a ordem para retomar. A lista histórica
de pendências deve ser lida junto desta atualização; Ctrl+K e a medição do CRM foram concluídos.

## Proteção automática da chamada no Teams (Claude, 11h51–11h58)

O usuário abriu o prejoin de uma sala própria (“Reunir agora”, sem convidados) na cópia de teste
(PID 4556, conferido antes de reabrir o diagnóstico na porta 9233). Microfone e câmera foram
desligados antes de “Ingressar agora”; o ingresso exibiu `#hangup-button` (`hangup-main-btn`,
“Sair”). “Manter em memória” desligado só na cópia, janela minimizada, **nenhuma hibernação
manual**. O monitor `teams-auto-protection-monitor.cjs` coletou 25 amostras em 6 min (prazo
minimizado de 2 min + passadas de até 60 s): **mesmo WebContents (id 7) vivo, chamada mantida e
janela minimizada em todas**. Evidência: `teams-auto-protection.json`. Depois, a sala foi
encerrada pelo próprio botão “Sair” e o diagnóstico foi fechado. A cópia continua minimizada.

Limite: o Chromium marcou a aba como silenciosa (`isCurrentlyAudible() === false`). O que segurou
a chamada foi a sonda genérica de DOM, que viu um `<audio>` tocando (`readyState` 4). Diferente do
Meet, o Teams não tem detector próprio de chamada em `serviceBusy`. Se o Teams deixar de usar um
elemento `<audio>` ativo, a proteção deixa de valer. O log “hibernação impedida” fica só em
memória (`recentLogs`), por isso a prova é o contraste com a hibernação de Teams fora de chamada,
em até 162 s, nesta mesma cópia.

**Correção do limite:** `serviceBusy` agora consulta `teamsInCall` (`apps/desktop/src/main/meet.ts`)
nas abas do Teams. A presença de `#hangup-button` mantém a aba acordada; sonda que falha ou passa de 3 s
também mantém. A proteção deixa de depender só do `<audio>`. Dois testes novos; build, typecheck,
lint e 769 testes passaram. Ainda não foi revalidado em chamada real com o build novo.

## Continuação do plano (Claude, 12h20–13h20)

### Teams fora de chamada com o build novo

A cópia foi relançada com o detector `teamsInCall`. Teams carregado, sem `#hangup-button`,
“Manter em memória” desligado só na cópia e janela minimizada: **hibernou pelo timer natural**
(15h29 UTC). O detector não impede a hibernação fora de chamada. Evidência:
`teams-idle-regression.json`. A semente reativa “Manter em memória” dos mensageiros a cada
boot (migração `keep-awake-messengers`); por isso foi preciso desligar de novo.

O lado de dentro da chamada **não foi refeito com o build novo**. O “Start an instant Teams
meeting” fica num iframe do `outlook.office.com`; clique de DOM e `sendInputEvent` não abriram
o prejoin com a cópia minimizada e sem foco. O `#hangup-button` usado pelo detector é o mesmo
confirmado na chamada real anterior (`hangup-main-btn`, “Sair”).

### PIN do WhatsApp: dois defeitos corrigidos

O teste `whatsapp-pin-test.cjs` foi rodado na cópia, com um WhatsApp sem login criado só nela e
um PIN aleatório nunca impresso. Ele revelou duas falhas do commit `d733afb`, que passou a fechar
a view do prompt para poupar RAM. O commit só existe nesta branch.

1. `webContents.close()` é assíncrono. O prompt encadeado (“Confirme o PIN”) chegava com a view
   anterior ainda fechando, era carregado nela e **nunca aparecia**: ativar o PIN travava.
2. Depois de destruída, a view fica com `webContents` `undefined`. O próximo `showPrompt` lançava
   `TypeError ... reading 'isDestroyed'`, a rejeição não era tratada e `whatsappUnlockPromptOpen`
   ficava `true`. Resultado: **o desbloqueio do WhatsApp não abria mais até reiniciar o app**.
   Isso afetava qualquer prompt depois do primeiro.

Correção em `showPrompt`/`hidePrompt` (`workspace-window.ts`): view em `closingViews` ou sem
`webContents` gera um prompt novo. Depois da correção, o teste passou inteiro: criar e confirmar
o PIN (campo secreto), bloquear, recusar PIN errado, desbloquear com o certo e bloquear de novo,
sem nenhuma `unhandledRejection` no log. Evidência: `whatsapp-pin-test.json`. Não há teste unitário,
porque é um closure da janela; a prova é esse teste de integração. Conta real do WhatsApp não
testada: a sessão do WhatsApp Web não se transfere por cookies.

### Notificações e hibernação

Pelo código: aba hibernada tem o WebContents destruído e não recebe notificações. Por isso
WhatsApp, Gmail, Outlook e Teams com “Manter em memória” ficam acordados, exceto em pressão
crítica (`messengerStaysAwake`). Desligar a opção troca notificações por RAM. Comprovar que as
notificações voltam depois de reabrir exige uma mensagem real chegando.

### Gmail na cópia

Neste relançamento, o Google recusou os cookies copiados (seletor de contas). Não houve tentativa
de login. O Gmail real não foi afetado.

## Fechamento do plano (Claude, 13h00–13h30)

O usuário autorizou que o Claude fizesse os testes restantes sozinho.

### Teams em chamada com o build novo: aprovado com prova direta

“Reunir agora” não abre na cópia (o botão recebe um clique confiável via CDP, mas nada acontece).
A sala veio de um evento próprio criado pelo conector do Outlook (sem convidados, “livre”). O
link abriu o prejoin na aba do Teams e a entrada foi feita com câmera e microfone desligados.
No ingresso, o `<audio>` estava com `readyState` 0, ou seja, a sonda antiga sozinha não teria
protegido a chamada.

Um primeiro monitor foi descartado: o `minimize()` nativo não pegou depois de `showInactive`, e
com a janela à vista a hibernação nem é tentada. Na repetição, a janela ficou oculta (`hide()`,
mesmo estado da bandeja), com “Manter em memória” desligado e sem hibernação manual. Logpoints do
inspector (sem pausar) em `canHibernate` registraram 4 passadas do timer para o Teams
(16h08–16h11 UTC): **o `teamsInCall` foi chamado em todas e a sonda de mídia nunca rodou**. A
chamada continuou no mesmo WebContents nas 25 amostras. Evidência: `teams-call-busy-proof.json`.
Depois disso a sala foi encerrada e o evento apagado (sem convidados, nenhum aviso de cancelamento).

### Outlook depois de hibernar e reabrir

O Outlook hibernou pelo timer (cerca de 2 min, janela oculta) e reabriu num WebContents novo
(12 → 13). Um email de teste para o próprio endereço **apareceu na aba reaberta em cerca de
10 s**. Evidências: `outlook-notify.json` e `outlook-notify-2.json`. Os dois emails de teste foram
para Itens Excluídos.

**Achado: o contador do Outlook não funciona no app.** O Outlook web não chamou
`navigator.setAppBadge`, nem com notificações permitidas (`Notification.permission` “granted”
depois de ligar as notificações só na cópia), nem com milhares de não lidos na caixa. Como o
`microsoft-badge-preload` depende só dessa API, o ícone do Outlook fica sem número. O print do
usuário mostra o mesmo no app instalado. Isso não é efeito da hibernação, porque a view reaberta
carrega do zero. Corrigir pede outra fonte de não lidos e fica como trabalho separado.

### Bloqueados por limite de segurança

- **Login Google pelo CRM**: na cópia, o Google recusou os cookies copiados e exige senha. O
  Claude não digita credenciais. O usuário precisa fazer esse login.
- **Mini-barra do Meet, aparência e flash de tema**: exigem uma chamada do Meet com conta Google
  na cópia, então caem no mesmo bloqueio. Além disso, são verificações visuais.
- **Atualização pelo instalador**: o handoff proíbe instalar sobre o app em uso.

## Contador de não lidos do Outlook (Claude, 13h35–13h45)

Correção do achado anterior. No painel de pastas, cada pasta do Outlook web tem um `title` com os
números (“Caixa de Entrada - 11.555 itens (6.771 não lidos)”). Mudanças:

- `microsoft-badge-preload.cjs` (só em `outlook.*`, frame principal): um `MutationObserver` envia
  ao main os `title` das pastas, no máximo 40 e cortados em 200 caracteres, só quando mudam.
  Não usa intervalo, que o Chromium segura em página oculta.
- `workspace-window.ts`: canal `service:folder-titles`, aceito só da view do Outlook e do frame
  principal. Aplica `applyUnread` com o primeiro título que for da caixa de entrada. O caminho
  pela Badging API continua valendo.
- `packages/service-adapters/src/outlook-badge.ts`: `unreadFromOutlookFolderTitle`, função pura com
  testes (PT/EN, milhar, outras pastas devolvem `null`). Rótulos por idioma, como no Gmail.

Validado na cópia, minimizada: o contador passou de 0 para **6771**, igual ao título da caixa. A
lateral mostra “99+” com rótulo acessível “6771 mensagens não lidas em Outlook”. Um email de teste
levou a 6772 ao vivo e, ao ir para a lixeira, voltou a 6771. Evidência: `outlook-badge-live.json`.
O email de teste está em Itens Excluídos. Build, typecheck, lint e 772 testes passaram. Não testado:
Outlook em outro idioma e caixas compartilhadas, além do app instalado. Para chegar ao instalado,
falta gerar e instalar uma versão nova.

## Atualização do app instalado (Claude, 13h47–13h55)

Feita a pedido do usuário, que reautenticou a conta CastLabs EVS no próprio terminal (sem a
senha passar pelo Claude). Passos:

1. `pack:dir` gerou `release/win-unpacked`. A assinatura VMP falhou de início porque o
   `castlabs-evs` não estava instalado. Ele foi instalado em `D:\Tools\Python312`, e depois do
   reauth `python -m castlabs_evs.vmp sign-pkg release/win-unpacked` assinou
   (`adr-workspace.exe.sig`).
2. Backups em `D:\Claude\adr-real-validation-20261020\`: `installed-state-backup/` (o
   `state.v1.json` real e o `.bak`) e `installed-app-backup/` (a instalação 0.1.53.0 inteira,
   373 MB), como ponto de volta.
3. `node scripts/update-local.mjs` fechou o app por WM_CLOSE e copiou a versão
   `0.1.53-test.4`. O app foi reaberto pelo executável instalado.

Comparação do perfil real (`installed-profile-before.json` × `installed-profile-after.json`):
schema 1 mantido; workspaces, os 19 serviços, os 11 perfis e as chaves de configuração
**idênticos**. Única mudança: a migração `keep-awake-messengers` ligou “Manter em memória” nos 10
mensageiros (WhatsApp, Gmail, Outlook e Teams), como esperado com `keepMessengersAwake` ligado.
Nenhum arquivo de estado corrompido ou recuperado. Não verificado por dentro: logins e aparência
do app instalado, porque o Claude não inspeciona o processo instalado. A pasta `Partitions` não é
tocada pela atualização.

## Itens finais validados pelo usuário (14h)

- **OAuth Google pelo CRM: não se aplica.** O usuário confirmou que o CRM não tem login Google. O
  `googleAuth` do código atende os popups de login dos serviços Google (Gmail, Calendar etc.), não
  o CRM. Item retirado do plano.
- **Mini-barra do Meet: aprovada** pelo usuário no app instalado `0.1.53-test.4`. Aparência e flash
  de tema não tiveram problema relatado; não foram inspecionados por screenshot.

Com isso, o plano da seção 13 está concluído.

## Aparência: flash de tema corrigido (Claude, 14h10)

Verificado sem screenshot: na cópia, `theme-bg-check.js` compara o fundo nativo da janela com o
fundo calculado do `body` do shell, trocando o tema pelas configurações. Antes, ao trocar para o
claro, a página ficava `#F4F6F8` e a janela continuava `#0D1526`: em tema claro, recarga ou
redimensionamento piscava escuro. O mesmo acontecia quando o Windows trocava de tema com o
tema “sistema”, porque não havia ouvinte de `nativeTheme`.

Correção em `workspace-window.ts`: `syncThemeBackgrounds` atualiza janela, shell, painel e barra do
navegador. É chamada na troca de tema e no evento `nativeTheme` `updated`, com remoção ao fechar
a janela. A cor nativa do shell passou da cor antiga da barra de título (`#0A0F1E`/`#FFFFFF`) para
o `--bg` do body, porque o shell agora cobre a janela inteira. Depois da correção, janela e página
coincidem em atual, claro, escuro e sistema (`theme-bg-check.json`). Build, typecheck, lint e 772
testes passaram. O app instalado `0.1.53-test.4` ainda não tem esta correção.

## App instalado com a correção de tema (Claude, 14h10)

A pedido do usuário: `pack:dir` com assinatura VMP (as credenciais EVS do reauth continuam
válidas), `update-local.mjs` e reabertura do app. O `app.asar` instalado contém
`syncThemeBackgrounds` e a assinatura `adr-workspace.exe.sig`. O perfil real ficou idêntico ao
estado gravado logo antes da atualização (`installed-state-backup/state.v1.before-tema.json`):
schema, migrações, workspaces, 20 serviços, 11 perfis e chaves de configuração. Nenhum arquivo de
estado corrompido ou recuperado.
