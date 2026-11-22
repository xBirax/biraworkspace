# ADR Workspace 0.1.47

## Novidades

- **Claude** e **Gemini** em **Adicionar serviço**. O Claude tem login próprio por
  conta, como o ChatGPT; o Gemini abre já logado na conta Google do workspace.
- **Login com Google, Apple ou Microsoft** no Claude, ChatGPT, Notion e Trello abre
  numa janela própria, como no Chrome, e se fecha ao terminar.
- **Limpar notificações** no botão direito do WhatsApp e do Gmail: o contador some e
  só volta com mensagem ou e-mail novo. Vale depois de reiniciar o app.
- Logo oficial do ChatGPT na barra lateral.
- Notion, ChatGPT e Claude duplicam em outra conta e podem ser renomeados.

## Correções

- **Spotify volta a tocar:** o app deixou de se identificar como "Electron" na aba do
  Spotify, que por isso entregava o player de celular.
- Corrigido o erro "Cannot read properties of undefined (reading 'setZoomFactor')"
  ao iniciar depois de um login no Claude.
- Chamadas ao CRM têm tempo limite: tradução e busca não ficam girando para sempre.
- O atualizador volta a verificar se ficar parado durante o download.

## Segurança

- **PIN do WhatsApp por sessão**: cinco erros bloqueiam por 30 s, e a espera dobra a
  cada bloqueio seguido (até 15 min). O limite vale para desbloquear, desativar e
  trocar o PIN e continua depois de reiniciar o app. O PIN global antigo é migrado
  com o mesmo código.
- Lusha isolada da página do LinkedIn.
- Mais tipos de arquivo perigosos nos downloads exigem confirmação para abrir.

## Desempenho

- A barra do ADR Browser só carrega quando é usada.
- Trocar de aba não grava mais o estado no disco a cada clique.

## CRM (extensão 0.15.5)

- WhatsApp: autoenvio por idioma e "copiar e-mail" nas mensagens.
- Gmail: o painel ADR CRM volta a aparecer e traduz o e-mail aberto.

## Atualizar

A atualização é baixada e instalada pelo próprio app (Configurações → Sobre →
**Buscar atualizações**). Sessões, contas e configurações são mantidas.
