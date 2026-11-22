# WhatsApp: regressão de compatibilidade após 0.1.39

## Achado confirmado

Gravidade: alta, tarefa bloqueada. A 0.1.39 removeu globalmente as adaptações de
identificação para reproduzir a configuração nativa que funcionou no Google Lab.
O WhatsApp passou a rejeitar a identificação Electron, embora o motor real fosse
Chromium 152, acima do mínimo que a própria página informa.

Reprodução Linux/Xvfb com CastLabs Electron 44.1.0, perfis temporários sem login:

1. Abrir `https://web.whatsapp.com/` com identificação nativa:
   `ADRWorkspace/0.0 Chrome/152.0.7977.65 Electron/44.1.0 Safari/537.36`.
   Resultado: “WhatsApp works with Google Chrome 100+”.
2. Remover somente os produtos `ADRWorkspace/...` e `Electron/...` do User-Agent
   da sessão e da view, preservando todo o restante.
   Resultado: “Scan to log in”, QR code renderizado e opção por número de telefone.

Evidência local da comparação: `/tmp/adr-wa-probe.log`,
`/tmp/adr-wa-native.png`, `/tmp/adr-wa-compatible.png`.

## Correção

- `apps/desktop/src/main/whatsapp-user-agent.ts`: adaptação exclusiva do tipo
  `whatsapp`; conserva OS, arquitetura e versão Chromium real.
- `workspace-window.ts`, `createServiceView`: aplica na sessão antes de criar a
  view e na view antes da primeira navegação. Cada conta WhatsApp já usa uma
  partição independente. As sessões Google continuam nativas.
- Não usa identificação global, manipulação de client hints, debugger, scripts
  de identidade ou limpeza de dados.
- Versão 0.1.40, candidato `v0.1.40-rc.1`; sem promoção para estável.

## Validação

- Build, typecheck, lint, `git diff --check`: passaram.
- Suíte: 300 testes (196 desktop, 104 demais pacotes), incluindo 11 novos casos.
- Electron real 35→44 em Linux: cookies e localStorage preservados em três
  partições sintéticas, backup conferido. Página, HTTP, worker e sessão WhatsApp
  usam a identificação compatível; Google/CRM conservam a identificação nativa.
- `scripts/runtime-session-fixture.cjs` passa a verificar esse isolamento também
  no pipeline Windows antes de gerar o NSIS.
- Pipeline Windows `36168001813`: build, tipos, suíte e migração sintética com
  isolamento de identificação passaram antes do empacotamento.
- Nova comparação usando o helper compilado e a **mesma partição**: identificação
  nativa reproduziu o aviso; configuração compatível abriu QR sem apagar cache;
  fechar e recriar a view manteve a tela de vinculação. Evidência local:
  `/tmp/adr-wa-persistent-probe.log`.
- O smoke do shell completo abriu a interface, mas parou no login obrigatório
  do CRM do perfil temporário. Não foi considerado teste completo de navegação
  nem foi contornado esse bloqueio. O teste público do WhatsApp acima usa uma
  janela Electron com o helper real, sem autenticação.

Limite: QR público não comprova retomada de conta autenticada. Conferência das
três contas reais, Gmail e CRM cabe ao desktop do usuário após instalar por cima,
sem desinstalar ou limpar dados. A validação anterior era insuficiente para
capturar rejeições específicas de sites; a reprodução pública foi acrescentada
nesta rodada, além dos testes sintéticos de armazenamento.
