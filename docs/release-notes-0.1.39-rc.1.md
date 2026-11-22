# ADR Workspace 0.1.39 — avaliação

Integra ao Workspace completo a configuração que permitiu ao usuário entrar no
Gmail web no ADR Workspace Lab e permanecer conectado após reabrir o teste.

- Atualiza CastLabs Electron 35/Chromium 134 para Electron 44.1.0/Chromium 152.
- Usa identificação nativa: remove User-Agent e client hints fabricados, scripts
  de identificação e o parâmetro que modificava sinais de automação.
- Preserva a página original do Google; o tradutor, o bloqueador e as sondagens de
  hibernação não interferem na página de autenticação Accounts.
- Cria uma cópia local antes de abrir os dados existentes com o motor novo.
- Mantém identidade do aplicativo, pasta de dados, partições, contas e configuração.

## Instalar

Feche normalmente o **ADR Workspace** e execute este instalador por cima da
versão atual, no mesmo usuário Windows. Não desinstale nem apague os dados.

Na primeira abertura, os dados persistentes são copiados para
`%APPDATA%\ADR Workspace Backups\before-electron44-…\profile`.
Caches regeneráveis ficam de fora; estado, cofre, cookies e armazenamento das
contas entram na cópia. A abertura pode demorar enquanto a cópia termina. Se ela
falhar, o aplicativo encerra antes de carregar as sessões. Não apague essa pasta
até concluir a avaliação. Cópias ficam somente neste computador.

Abra Gmail no Workspace e faça login. A sessão do Lab é separada e não é importada.
Confira também as sessões de WhatsApp e CRM e feche/reabra o aplicativo.

## Validação e limites

A suíte local passou com 289 testes; build, tipos e lint passaram. Um teste real
com Electron 35 criou cookies e armazenamento em três partições sintéticas;
o Electron 44 leu os mesmos dados e a cópia de recuperação foi conferida. O
pipeline Windows repete essa verificação antes de empacotar/publicar.

O login real e a persistência foram confirmados pelo usuário no Lab. Gmail,
WhatsApp, CRM e Spotify no aplicativo completo ainda exigem avaliação humana.
Serviços podem solicitar nova autenticação por decisão do provedor.

A versão é de avaliação e usa download manual. Os instaladores anteriores
continuam disponíveis. Para voltar ao motor antigo após a migração, use uma
cópia anterior com o aplicativo fechado; instalar o executável antigo sozinho
não reverte os formatos de armazenamento do Chromium.
