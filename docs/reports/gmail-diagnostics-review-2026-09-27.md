# Revisão: painel Gmail e diagnóstico do ADR Workspace

Data: 27/09/2026. Escopo: integração do painel CRM no Gmail embutido e na extensão Chrome, IPC/preload, leitura de rascunhos, consulta de contatos/negócios e apresentação do diagnóstico. Código do CRM na branch `codex/gmail-crm-assistant`; código do Workspace na branch `codex/gmail-performance-browser`.

## Achados corrigidos

| Gravidade | Reprodução e impacto | Correção |
|---|---|---|
| Alta | No Gmail embutido, `window.adrGmail.invoke` era exposto à página. JavaScript executado no site podia solicitar consulta ao CRM e geração de texto sem passar pelo painel. | O script Gmail agora é incorporado ao `gmail-preload.cjs` e executa no mundo isolado do Electron. O IPC fica no preload; não há ponte no mundo principal. O processo principal continua validando serviço, frame e origem. |
| Média | Após solicitar uma prévia, alterar assunto, idioma ou corpo deixava a resposta antiga copiável. Uma resposta atrasada também podia preencher campos de outra conta Gmail ou de um pedido alterado. | Campos alterados invalidam a prévia; respostas com endereço, caminho da conta ou campos diferentes são descartadas. |
| Média | Com vários rascunhos abertos, **Usar texto do rascunho** lia o primeiro editor visível, mesmo se outro estivesse em foco. | O painel acompanha o último editor usado; quando há ambiguidade, pede que o usuário escolha o rascunho. |
| Média | Um usuário com acesso a contatos mas sem `crm.deals.view` perdia toda a consulta quando a busca dos negócios retornava 403. | O contato permanece visível, com aviso de que os negócios não estão disponíveis para sua permissão. Outros erros continuam sendo apresentados. |
| Baixa | A UI dizia “RAM em uso agora” mesmo para uma análise antiga e podia esconder pressão de disco atrás de entradas de inicialização. | A métrica foi rotulada como última análise; avisos de memória, CPU e disco têm prioridade na lista curta. |
| Baixa | A consulta Gmail embutida não tinha prazo de rede; o botão podia ficar ocupado indefinidamente. | Consultas a contatos e negócios agora têm limite de 20 segundos por chamada e mensagem clara no timeout. |
| Baixa | O IPC aceitava um corpo não estruturado até tentar ler campos, produzindo erro interno pouco claro. | O processo principal recusa corpos nulos, listas e tipos diferentes de objeto antes de processar o comando. |
| Média | Duplo clique em **Restaurar** podia abrir duas confirmações antes de o estado `busy` ser ativado; outros comandos também confiavam só no botão desabilitado. | O painel bloqueia uma segunda confirmação e verifica `busy` nos handlers de análise, prévia e aplicação. Botões de restauração somem enquanto ela executa. |

O acesso ao Gmail permanece no perfil persistente existente. Nenhum caminho de migração, limpeza de cookies ou alteração de sessão foi introduzido.

## Contratos e limites confirmados na revisão

- A lista de negócios usa o filtro `contactId` da API do CRM, que retorna negócios cujo **contato principal** é o contato consultado. Contatos adicionais ainda não entram nesse painel; texto da interface e documentação foram ajustados para não sugerir uma lista completa.
- A extração do rascunho depende do DOM do Gmail (`contenteditable` e caixa de composição). Mudanças na interface do Google exigem validação visual e eventual ajuste do seletor.
- O painel não envia e-mails nem modifica o rascunho automaticamente. A prévia precisa ser copiada pelo usuário.
- A extensão Chrome requer atualização assinada e aceitação da permissão `mail.google.com`. O instalador Workspace deve ser publicado depois da rota `/api/gmail/assistant` do CRM.

## Validação e publicação pendentes

- Na revisão local, build, typecheck e lint do ADR Workspace passaram; `node --check` do preload Gmail gerado e dos scripts da extensão passou; ESLint direcionado da extensão passou; os três arquivos vendorizados (manifest, background e painel) foram comparados byte a byte com a origem CRM. `git diff --check` passou. A [CI do commit `94b14e8`](https://github.com/ADRAGENCIACRM/adrworkspace/actions/runs/36323111564) concluiu com sucesso, incluindo build, typecheck, lint, testes e compilação do helper nativo Windows. Essas verificações não substituem a interação real com Gmail e o instalador Windows.
- Fazer smoke no Windows em instalação limpa e atualização, mantendo CRM/Gmail/WhatsApp conectados. Conferir que `window.adrGmail` não existe no contexto da página, que cliques sintéticos não iniciam consultas, que múltiplos rascunhos mostram o editor certo e que prévias antigas são descartadas.
- Conferir conta pessoal e Google Workspace, Gmail `/mail/u/0` e `/mail/u/1`, sessão expirada do CRM, permissão somente de contatos e respostas 403/429/timeout.
- O artefato da extensão precisa da chave corporativa existente; o pacote não deve ser assinado com chave nova. A publicação estável do instalador e da extensão depende do smoke acima.

Referências da decisão de isolamento: [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) e [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox).
