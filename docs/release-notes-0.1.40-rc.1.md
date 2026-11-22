# ADR Workspace 0.1.40 — avaliação

Corrige a regressão da 0.1.39 em que o WhatsApp exibia “Chrome 100 ou posterior”,
mesmo com Chromium 152 instalado.

- Ajusta a identificação somente nas sessões de WhatsApp, mantendo a versão real
  do Chromium e o sistema operacional.
- Mantém a identificação nativa do Gmail/Google e o motor validado no Lab.
- Preserva as mesmas pastas de dados e partições; não limpa cookies, contas ou sessões.
- Mantém a cópia de recuperação criada antes da primeira migração para Electron 44.

## Instalar

Feche normalmente o ADR Workspace e execute o instalador por cima da versão atual,
no mesmo usuário Windows. Não desinstale nem apague os dados. Depois confira as
três contas WhatsApp, Gmail e CRM e feche/reabra o aplicativo.

## Validação

O aviso foi reproduzido no Electron 44 com a identificação nativa. Ajustando apenas
o WhatsApp, o site abriu a tela de vinculação por QR code em um perfil temporário.
Build, typecheck, lint e 300 testes passaram. A validação de migração usa cookies
e armazenamento sintéticos e confere a identificação da página, requisições e
workers, mantendo Google separado. O pipeline Windows repete os testes antes de
publicar o instalador.

As contas reais do usuário precisam ser conferidas no desktop; o teste público
não autentica WhatsApp. Esta versão permanece de avaliação, com download manual.
