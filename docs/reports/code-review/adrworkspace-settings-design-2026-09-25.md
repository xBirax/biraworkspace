# Configurações — redesign 0.1.41

## Escopo

Entrada: `apps/desktop/src/shell/panel.html`, painel Geral e demais cinco abas.
O estilo passa a ficar em `panel.css`, incluído explicitamente pelo empacotador
`apps/desktop/scripts/copy-preload.mjs`.

- Menu com ícones, seleção verde ADR e organização compacta em pouca largura.
- Geral organizado em identidade, rotina/desempenho, navegação e suporte.
- Ferramentas de otimização recolhidas por padrão; ações e confirmações existentes
  continuam disponíveis ao expandir.
- Escala exibida em porcentagem; o contrato de IPC continua usando fator 0.8–2.
- Prévia dos temas, controles uniformes e estados acessíveis de seleção.
- Rótulos acessíveis em controles estáticos e nos bloqueios/notificações por conta.
- Layout também considera a largura útil após o zoom CSS; media queries sozinhas
  não resolviam os cortes dos botões de Serviços e Privacidade em 200%.

Nenhum código de partições, cookies, autenticação ou persistência foi modificado.
Mantém a correção de compatibilidade WhatsApp da 0.1.40.

## Evidência

`scripts/verify-settings-panel.cjs` abre o painel **do build** em Electron real,
com estado e chamadas IPC simulados, sem contas autenticadas. A conferência foi
adicionada ao pipeline Windows antes de empacotar o NSIS.

- 72 combinações: seis abas × dois temas × duas larguras (1280/800) × três escalas
  (80%/100%/200%). Nenhum transbordamento horizontal.
- Tab do menu para o nome do workspace com foco visível.
- Escala 150% enviada como `uiScale: 1.5`.
- Inicialização, diagnóstico, atualização e tema mantêm as chamadas existentes.
- Capturas dos temas claro e escuro, além da aba Aparência.
- Sem erros JavaScript na execução do fixture.

Limite: o fixture confere layout e contratos da UI; não faz alterações reais nas
contas nem executa otimizações do Windows. A suíte do monorepo e os demais gates
continuam obrigatórios na publicação.

## Ajuste do teste de migração

A primeira execução Windows (`36177467899`) passou nos testes da aplicação e no
fixture visual, mas encontrou `EBUSY` ao copiar o LevelDB da sessão padrão.
O fixture criava uma BrowserWindow antes do backup, contrariando a ordem usada
em produção. O orquestrador agora executa a mesma função de backup com os dois
runtimes fechados, antes de iniciar o Electron 44; o fixture encerra normalmente
com `app.quit()`. Nenhum arquivo é ignorado para contornar o erro e o código de
backup do aplicativo permanece intacto. Publicação repetida como `v0.1.41-rc.2`.
