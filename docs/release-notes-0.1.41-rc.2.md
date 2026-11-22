# ADR Workspace 0.1.41 — avaliação

Novo visual para as configurações, mantendo a identidade ADR.

- Navegação com ícones e indicação clara da seção aberta.
- Preferências agrupadas em rotina e desempenho, navegação, atualização e suporte.
- Escala da interface em porcentagem, de 80% a 200%.
- Interruptores consistentes, nomes acessíveis e foco visível pelo teclado.
- Prévias dos temas claro, escuro e do sistema.
- Ferramentas do Windows em uma seção expansível.
- Layout adaptável à largura disponível, inclusive com escala de 200%.

As mudanças usam as configurações existentes. Contas, sessões, cookies e
partições permanecem no mesmo local. Inclui a correção do WhatsApp da 0.1.40.

## Instalar

Feche o ADR Workspace normalmente e instale por cima da versão atual, no mesmo
usuário Windows. Não desinstale nem apague os dados.

Esta é uma versão de avaliação, com download manual.

## Validação

Painel renderizado no Electron com dados simulados: seis abas, dois temas,
duas larguras e escalas de 80%, 100% e 200% (72 combinações). Verificados
transbordamento horizontal, foco por teclado e contratos dos controles.
O pipeline Windows repete essa conferência antes de empacotar. A conferência
visual usa estado simulado; não autentica nem modifica contas reais.
