# Integração do motor nativo — 25/09/2026

O usuário confirmou login no Gmail no Lab 0.1.0 e persistência depois de fechar
completamente e reabrir. Esse teste usou Electron 44.1.0/Chromium 152.0.7977.65,
identificação nativa e perfil separado.

A versão completa 0.1.39 integra o mesmo motor e remove a reescrita de
User-Agent/client hints, scripts de identificação e AutomationControlled.
O login Accounts não recebe overlay do tradutor, guard de notificações, sondagem
de mídia/hibernação ou evento de resize injetado. Recursos de Accounts não passam
pelo bloqueador. Recursos do aplicativo fora da autenticação permanecem ativos.

A identidade Windows, o nome ADR Workspace, o diretório de dados e os nomes de
partições continuam os mesmos. Há trava de instância e cópia local antes da
primeira inicialização de sessões no motor novo. Falha de cópia encerra o app;
não há limpeza de dados. Cache regenerável fica de fora da cópia.

## Evidências locais

- Build do monorepo, tipos e lint passaram.
- Suíte completa: 288 testes; um teste adicional de falha de backup passou em
  seguida (total esperado no CI: 289).
- Fixture executou Electron 35.7.5 → Electron 44.1.0 com cookies persistentes,
  secure/HttpOnly e localStorage em três partições independentes (WhatsApp, CRM e
  Google sintéticos). Leitura após troca e backup passaram. Nenhuma conta real.
- Shell completo abriu em Xvfb com uma janela visível, sete webContents e
  identificação nativa em todos. Perfil temporário; comando Linux root usou
  --no-sandbox exclusivamente nesse smoke, nunca no produto Windows.
- Houve aviso de CSP da página CRM em desenvolvimento e aviso de assinatura de
  console-message depreciada; abertura completou. Não foi teste autenticado CRM.
- O pipeline Windows repete a fixture entre motores antes de gerar o NSIS.

## Limites

Sucesso no Lab não prova sozinho o fluxo no Workspace completo. Usuário deve
validar Gmail no instalador integrado, login após reabrir, WhatsApp, CRM, Spotify e
demais serviços. Testes sintéticos não simulam revogação de sessão por provedores.
O Lab não transfere cookies para o aplicativo principal.

Para rollback, manter executável anterior e cópia feita antes do motor novo;
não abrir um perfil já migrado com Chromium antigo sem restauração controlada.
