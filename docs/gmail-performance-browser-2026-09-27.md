# Gmail, desempenho e limites do ADR Browser

Revisão de código e pendências de publicação: [relatório de 27/09](reports/gmail-diagnostics-review-2026-09-27.md).

## Integração CRM no Gmail

O pacote `vendor/adr-crm-extension-0.15.3` traz `gmail-content.js` para o Gmail
embutido. No Chrome/Edge, a mesma versão da extensão é produzida no repositório
ADR CRM. O painel consulta um e-mail informado pelo usuário e apresenta contatos
e negócios em que são contato principal; a geração de e-mails usa `POST /api/gmail/assistant` no CRM.
Por isso a rota do CRM precisa estar publicada antes do instalador do Workspace ou
da extensão Chrome. Não há leitura automática de mensagens nem envio automático.
O Gmail continua na mesma partição persistente; a instalação não migra nem apaga
cookies, IndexedDB ou sessões.

O script do painel é incorporado ao `gmail-preload.cjs` no build. Ele roda no mundo
isolado do Electron e chama somente `gmail:invoke`; nenhum comando CRM é exposto
ao JavaScript da página do Gmail. O Shadow DOM fechado e a exigência de eventos
reais impedem que scripts da página acionem o painel por DOM. Respostas tardias
são descartadas quando endereço, conta ou campos mudam. A prévia antiga é removida
quando os campos de geração mudam. Se o usuário tem acesso a contatos, mas não a
negócios, o painel mostra o contato e informa a restrição.

Atualização de 01/10/2026 (extensão 0.15.5):

- O painel **nunca montava** no Workspace: o Gmail exige Trusted Types, e o
  `root.innerHTML = ...` era bloqueado ("This document requires 'TrustedHTML'
  assignment"), inclusive no mundo isolado do preload. A interface agora é criada
  elemento a elemento. Regra: **nada de HTML como texto** no painel (`innerHTML`,
  `outerHTML`, `insertAdjacentHTML`); `build.test.ts` falha se voltar.
- O botão "ADR CRM" fica no **canto inferior esquerdo**: no direito ele cobria a
  seta do painel lateral do Google e as ações das janelas de "Escrever".
- "Traduzir e-mail aberto" envia ao serviço de tradução do CRM o corpo da mensagem
  recebida mais recente (ou o trecho selecionado), até 6.000 caracteres, só no
  clique do usuário. Não há tradução automática.

## Refinamentos no diagnóstico

1. RAM ocupada na última análise em porcentagem, com barra visual.
2. RAM usada em bytes legíveis.
3. RAM total no mesmo cartão.
4. RAM disponível estimada, sem confundir com ganho após otimização.
5. RAM consumida pelo ADR Workspace.
6. Participação do Workspace na RAM física, contando processo compartilhado uma vez.
7. CPU média da coleta de 15 segundos, com barra.
8. Duração de CPU acima de 80% e destaque de pressão sustentada.
9. Espaço livre e capacidade do disco do perfil, com destaque abaixo do limite.
10. Aviso explícito quando a medição tem mais de 15 minutos.
11. Aviso de RAM acima de 85% por dez segundos ou mais.
12. Lista curta do que pode melhorar, com pressão de CPU, memória e disco em primeiro plano.
13. Contagens separadas de ajustes, orientações e opções de limpeza.
14. Atalhos adicionais para telas nativas do Windows: aplicativos, notificações e gráficos.

Os valores só representam a última análise local. Para ver o estado atual, o
usuário deve escolher **Analisar agora**; nenhuma alteração é feita nessa etapa.

## Windows e extensões

A primeira fase do otimizador altera somente opções do usuário suportadas pelo
catálogo, com prévia e restauração. Ajustes administrativos exigem o componente
separado, assinado e validado, descrito no plano da Central de Desempenho. O
Workspace não executa um script elevado genérico para desligar serviços ou
proteções do Windows. Os atalhos abrem páginas nativas para decisão manual.

O ADR Browser usa Chromium do Electron, mas o Electron implementa apenas parte
das APIs de extensões. Ele não instala extensões diretamente da Chrome Web Store
e só carrega extensões descompactadas compatíveis, por sessão persistente. Não
se deve prometer paridade com Chrome/Edge. A extensão ADR no Gmail é injetada
pelo aplicativo e não depende desse suporte parcial.

## Validação antes de publicar

- CRM: publicar `/api/gmail/assistant` e conferir acesso pessoal, cota e
  comportamento sem sessão/impersonação.
- Extensão Chrome: empacotar com a chave corporativa e validar ID fixo, Gmail e
  WhatsApp; a nova permissão `mail.google.com` precisa ser aceita na atualização.
- Workspace: smoke no Windows com Gmail e CRM autenticados, alternância de
  workspaces, rascunho preservado, painel após reiniciar e análise de RAM. Conferir
  que `window.adrGmail` não existe na página e que consultas só saem após clique.
- Instalador: fazer instalação limpa e atualização sobre a versão anterior com
  sessões preservadas antes de promover a publicação estável.
