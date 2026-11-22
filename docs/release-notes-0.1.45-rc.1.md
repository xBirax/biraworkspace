# ADR Workspace 0.1.45 — avaliação 1

- Trello web disponível em **Adicionar serviço**, com login Atlassian próprio
  para cada conta. Quadros, cartões e notificações permanecem no próprio Trello;
  não há acesso à API nem sincronização automática com o CRM.
- A tela **Atualização e suporte** distingue versões estáveis de candidatas e
  oferece um link para baixar a avaliação manualmente. A versão 0.1.43 já
  instalada só procura releases estáveis, portanto não encontra `-rc`.
- Nenhuma partição existente, cookie, PIN, cofre ou sessão foi migrado ou apagado.
  Para avaliar, feche o Workspace e instale por cima no mesmo usuário Windows.
  Não desinstale nem limpe os dados locais.

Esta é uma versão de avaliação. A atualização pelo botão interno só será
disponibilizada após o smoke real de `docs/windows-release-smoke.md` e a
publicação estável correspondente.
