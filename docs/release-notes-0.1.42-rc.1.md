# ADR Workspace 0.1.42 — avaliação

O visual das demais telas internas agora acompanha as configurações modernizadas na 0.1.41.

- Barra lateral e barra de título com seleção, foco e cores consistentes.
- Busca rápida com resultados acessíveis pelo teclado e indicação de ação.
- Notificações com estado vazio claro e cartões mais legíveis.
- Diálogos de nome e PIN nos temas claro e escuro.
- Barra do navegador com rótulos mais claros, ícones consistentes, favoritos que podem ser removidos e layout adaptável à largura da janela.
- Estado de falha do CRM com botão para tentar novamente, no tema selecionado.

As páginas dos serviços, como Gmail, WhatsApp e CRM, continuam sendo as páginas dos próprios serviços. A atualização não altera partições, cookies, contas ou sessões.

## Instalar

Feche o ADR Workspace normalmente e instale por cima da versão atual, no mesmo usuário Windows. Não desinstale nem apague os dados.

Esta é uma versão de avaliação, com download manual.

## Validação

As telas internas foram renderizadas no Electron com dados sintéticos, em temas claro e escuro, inclusive com a barra do navegador em largura reduzida. O pipeline Windows executa as verificações do projeto e empacota o instalador. A conferência visual não autentica nem modifica contas reais.
