# ADR Workspace 0.1.49

- Clicar na notificação do WhatsApp abre a conta e a conversa correspondentes.
  Sessões protegidas pedem o PIN antes da abertura; cancelar o PIN mantém a
  conversa fechada.
- A abertura aguarda a lista de conversas carregar e usa a busca lateral quando
  a conversa está fora da lista visível. Nomes parciais ou ambíguos não abrem
  outra conversa.
- Notificações do CRM ficam bloqueadas, inclusive em segundo plano e em
  instalações que tinham uma permissão antiga habilitada.
- Inclui as melhorias já presentes no main para links externos e janelas de
  autenticação: links de outros sites usam o navegador configurado no app.

Atualização sobre a instalação existente, preservando o perfil e as sessões.
