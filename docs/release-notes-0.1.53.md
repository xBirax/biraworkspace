# ADR Workspace 0.1.53

Contas Microsoft com Outlook e Teams, histórico do ADR Browser, Bitwarden no
Cofre ADR e o code review geral: menos memória, chamadas protegidas e várias
correções do dia a dia.

## Atualizar

Pela atualização automática (Configurações → Sobre → Buscar atualizações), ou
com o instalador por cima da versão atual: as sessões continuam logadas.

Na primeira abertura, WhatsApp, Gmail, Outlook e Teams passam a ter
“Manter em memória” ligado quando a opção geral de manter os mensageiros
acordados estiver ligada (como antes). Cada serviço pode mudar isso no menu do
ícone ou em Configurações → Serviços.

## Outlook e Teams

- **Outlook e Teams como serviços.** A mesma conta Microsoft divide a sessão
  entre os dois; outra conta é outro perfil. “Contas Microsoft” em Perfil e
  contas: renomear, sair, adicionar.
- “Continuar com Microsoft” nos serviços com login próprio usa a conta do
  workspace.
- Outlook pessoal abre direto na caixa (outlook.live.com); adicionar de novo
  reaproveita a conta que já estava logada.
- **Contador de não lidos do Outlook** na barra lateral e na barra de tarefas,
  lido da Caixa de Entrada.
- **Chamada do Teams protegida:** a aba não hiberna durante uma reunião,
  mesmo com câmera e microfone desligados.
- Teams com câmera, microfone, tela cheia e apresentação de tela.

## ADR Browser e Cofre

- Histórico local criptografado (Ctrl+H) e abas restauradas ao reabrir.
- Um só ícone do ADR Browser na barra lateral, com “· N abas”.
- **Sincronizar com Bitwarden** no Cofre ADR, pela CLI oficial `bw`
  (instalada por você; o app não a embute).
- “Continuar com Google” do TikTok usa as contas Google do workspace.
- Tradutor do composer com minimizar e fechar.

## Memória e desempenho

- Menos processos residentes: Configurações e prompts só carregam quando
  usados; a mini-barra do Meet fecha depois da reunião.
- Prazo de hibernação por serviço e “Manter em memória” para cada mensageiro.
- Rascunho editado continua protegido da hibernação mesmo depois de perder o
  foco; conteúdo intocado pode hibernar.
- Windows bloqueado conta como “ninguém olhando” para a hibernação.

## Correções

- **PIN do WhatsApp:** a confirmação do PIN aparece de novo ao ativar o
  bloqueio, e o desbloqueio não trava mais depois do primeiro diálogo.
- **Sem flash de tema:** a janela acompanha a troca entre claro, escuro e
  sistema; antes, no tema claro, recarregar ou redimensionar piscava escuro.
- A atualização não instala no meio de uma chamada.
- Sair da conta Google não recarrega Browser, Spotify, YouTube nem Meet em
  chamada.
- Link do Meet/Teams de outro workspace não se perde.
- Contraste AA no tema claro; foco volta à aba ao fechar paleta, notificações
  e prompt.
- Robustez: estado de versão mais nova não é mais posto em quarentena, o Cofre
  não casa sufixo público (`com.br`) com qualquer site, o histórico não é
  sobrescrito depois de falha de leitura.
