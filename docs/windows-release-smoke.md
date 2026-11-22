# Smoke obrigatório antes da publicação estável no Windows

Execute em Windows 11 x64 e, quando houver suporte, Windows 10 22H2. Registre
versão, instalador, máquina, data, resultado e evidência de cada cenário. Use
contas de avaliação; preserve o perfil original antes de qualquer atualização.

1. Instale em um perfil limpo. Abra o CRM, Gmail e WhatsApp; conclua os logins,
   feche o app e abra novamente. Confira sessões, PIN, notificações e logo.
2. Atualize uma instalação da versão estável anterior com essas sessões abertas.
   Confira os mesmos serviços antes e depois de fechar e reabrir o aplicativo.
3. Edite um formulário no CRM sem salvar, troque de workspace e minimize a
   janela por mais de dois minutos. Volte e confirme que o rascunho permanece.
4. Na Central de Desempenho, analise, revise uma prévia, aplique um ajuste
   reversível em conta de avaliação e restaure pelo histórico. Confira o valor
   efetivo no Windows. Valide um registro interrompido em máquina isolada.
5. Na limpeza, confira a prévia e a confirmação específica. Use apenas arquivos
   temporários de avaliação antigos e confirme que um arquivo aberto, um arquivo
   recente e dados fora de Temp não são excluídos.
6. Teste o logout Google e confira que falhas são exibidas, sem afetar o login
   de outros serviços na partição.
7. No Gmail embutido, entre com uma conta pessoal e uma corporativa em contas
   separadas. Confira o painel ADR CRM, uma consulta de contato, a prévia em
   inglês e espanhol e a cópia manual para um rascunho. Mude o texto enquanto a
   prévia é gerada: a resposta antiga não pode ser copiável. Com dois rascunhos
   abertos, confirme que o painel usa o editor escolhido. Feche e reabra o app e
   confirme que o Gmail continua autenticado.
   Repita com a resposta inline de uma conversa; **Usar texto do rascunho** deve
   ler somente o editor em foco. Confira no diagnóstico o estado `gmail-panel`.
8. Verifique no contexto da página que `window.adrGmail` não existe e que um
   clique sintético não inicia consulta ao CRM. Confira sessão CRM expirada,
   usuário com acesso apenas a contatos e resposta demorada da API. O painel
   não pode enviar e-mail por conta própria.
9. Adicione Trello, faça login Atlassian, abra um quadro, feche e reabra o app.
   Confirme sessão persistente. Adicione uma segunda conta Trello e confirme
   que as duas continuam separadas. Confira que autenticação externa necessária
   usa a opção de abrir no navegador escolhido, sem migrar cookies do CRM.
   Adicione ChatGPT, entre no site e confira conversa, recarga e sessão após
   reiniciar. Duplique o serviço e confirme que as duas contas ficam isoladas.
   Confira também o fluxo de login com Google e o pedido de microfone para voz.
   Repita com Claude (login próprio, duplicar isola) e Gemini (deve abrir já
   logado na conta Google do workspace). "Continuar com o Google" deve abrir uma
   janela de login separada que se fecha ao terminar, com a aba intacta.
   No ADR Browser, abra linkedin.com/login e use "Continuar com o Google": o login
   abre em janela própria e a aba do LinkedIn não fica em branco.
   No ChatGPT e no Gmail, clique em um link para outro site: abre no navegador
   padrão e a aba do serviço continua na conversa/e-mail.
   Abra o Spotify: deve carregar o player de desktop, não o de celular, e tocar.
   No WhatsApp com mensagens não lidas, use **Limpar notificações** no botão
   direito: o contador some, continua sumido após reiniciar e volta só com
   mensagem nova.
   Receba uma mensagem com outra aba aberta e a janela minimizada: clique no
   aviso e confira a conta e a conversa abertas. Repita com PIN por sessão e
   com a lista de conversas rolada ou filtrada. Confira que cancelar o PIN não
   abre a conversa. CRM não deve mostrar avisos, inclusive em segundo plano,
   mesmo com uma preferência antiga de notificações habilitadas.
10. Em Atualização e suporte, confira que **Verificar** não chama uma candidata
    de avaliação de versão estável; **Ver candidatas** deve abrir a página de
    releases. Atualize sobre a versão anterior sem desinstalar nem limpar dados.

Publique a tag estável somente por `workflow_dispatch`, selecionando a própria
tag, marcando `windows_smoke_confirmed` e informando `smoke_evidence` com o link
ou referência ao registro dos resultados. O push da tag gera artefatos, mas não
publica a atualização estável.
