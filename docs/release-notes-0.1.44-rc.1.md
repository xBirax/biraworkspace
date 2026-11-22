# ADR Workspace 0.1.44 — avaliação 1

Esta candidata acrescenta o painel **ADR CRM** ao Gmail embutido e melhora a
Central de Desempenho. No Gmail, é possível consultar manualmente um contato
pelo e-mail, ver os negócios em que ele é o contato principal e preparar uma
prévia em inglês ou espanhol. O envio continua manual no Gmail; o Workspace não
envia e-mails nem lê mensagens ao abrir a página.

- O painel roda no preload isolado do Electron. A página do Gmail não recebe uma
  API para solicitar dados do CRM.
- A prévia deixa de ser copiável quando o texto muda. Respostas atrasadas são
  descartadas se a conta ou os campos mudarem. Com vários rascunhos abertos, o
  editor precisa ser escolhido antes da leitura.
- O diagnóstico indica que os números de RAM pertencem à última análise e
  prioriza alertas de memória, CPU e disco. A restauração bloqueia confirmações
  duplicadas.
- A consulta de contatos continua disponível para usuários sem permissão de
  negócios, com aviso de acesso parcial.
- Inclui correções de segurança e recuperação da Central de Desempenho da
  branch de revisão anterior. A limpeza do Temp segue explícita e irreversível;
  nenhuma otimização é aplicada ao abrir o aplicativo.

Os dados locais, cookies, IndexedDB, PIN, cofre e partições das sessões não são
migrados nem apagados. **Feche o Workspace normalmente e instale por cima, no
mesmo usuário Windows. Não desinstale nem limpe os dados locais.**

Esta é uma versão de avaliação com download manual. O botão **Verificar
atualizações** recebe somente releases estáveis. A publicação estável depende
do roteiro de `docs/windows-release-smoke.md`, incluindo instalação limpa,
atualização sobre a versão anterior e conferência das sessões CRM, Gmail e
WhatsApp. Preserve o instalador anterior para recuperação.

Revisão técnica: `docs/reports/gmail-diagnostics-review-2026-09-27.md` e
`docs/reports/performance-center-2026-09-26.md`.
