# ADR Workspace 0.1.43 — avaliação 2

Esta candidata inclui a nova página **Configurações → Desempenho**. Ela analisa
localmente CPU, memória, processos do Workspace, espaço do volume do perfil,
serviços carregados, inicialização e planos de energia. Você escolhe as ações,
confere a prévia e consulta o resultado no Histórico. Nada é otimizado durante
a abertura do aplicativo.

- A hibernação recomendada preserva abas com mídia, login, formulário alterado,
  download ou configuração “manter sempre ativo”. Uma verificação inconclusiva
  mantém a aba aberta.
- O limite de views pode voltar ao valor anterior quando não houve outra
  alteração depois. Ajustes da inicialização do usuário e de energia têm
  restauração com detecção de conflito, pendente de smoke em Windows isolado.
- O fluxo antigo que elevava um script PowerShell editável foi removido.
- A limpeza limita-se a arquivos antigos do Temp do usuário, exige prévia e
  confirmação própria de exclusão definitiva. Ela deve ser avaliada primeiro
  em um perfil Windows isolado; não apaga sessões nem admite desfazer. O backup
  do otimizador antigo fica preservado e
  identificado como não verificado; não há restauração automática desse legado.
- A página funciona com teclado, temas claro/escuro e escala de 80% a 200%.

O perfil local, as partições de sessão, cookies, PIN, cofre e backups de
recuperação não são migrados nem apagados por esta atualização. Feche o Workspace
normalmente e instale por cima da versão anterior no mesmo usuário. Não
desinstale nem apague os dados locais.

**Versão de avaliação, com download manual.** A publicação estável depende de
testes em Windows com instalação/atualização e persistência de sessões.

Detalhes e recuperação: `docs/reports/performance-center-2026-09-26.md`.
