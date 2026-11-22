# ADR Workspace 0.1.47-rc.4

Inclui tudo da 0.1.47-rc.3 (Claude, Gemini, logo do ChatGPT, login em janela
própria, aba fechada pela página recriada) e mais:

## Segurança

- **PIN do WhatsApp:** cada sessão tem cofre próprio; o PIN global antigo é migrado
  uma vez, com o mesmo código. Cinco erros bloqueiam por 30 s e cada bloqueio seguido
  dobra a espera (até 15 min). O limite vale para desbloquear, desativar e trocar o
  PIN e continua depois de reiniciar o app.
- Com a criptografia do Windows indisponível, a recuperação sem PIN não é oferecida.
- **Lusha:** o cartão roda isolado da página do LinkedIn; os scripts do site não leem
  os dados revelados nem clicam em "Revelar".
- **Downloads:** imagens de disco (.iso, .vhd), ajuda compilada (.chm), atalhos
  (.url) e outros formatos que executam algo não abrem mais com um clique.

## Confiabilidade

- Chamadas ao CRM têm tempo limite de 30 s: tradução e busca não ficam girando
  para sempre.
- O atualizador volta a verificar se ficar 15 min parado em "baixando".
- Trocar de aba não grava mais o estado no disco a cada clique.

## CRM (extensão 0.15.5)

- WhatsApp: autoenvio por idioma (inglês/espanhol) e "copiar e-mail" nas mensagens.
- Gmail: o painel ADR CRM volta a aparecer e traduz para português o e-mail aberto.

## Publicação

- A candidata passa a ter a própria versão (`0.1.47-rc.4`), para quem testou receber
  a estável `0.1.47` pelo atualizador.
