# Validação local — BiraWorkspace 0.2.0-local.1

## Atualização: migração do WhatsApp em 17/11/2026

Após a validação inicial abaixo, foram importadas as duas sessões reais do ADR para o grupo **WhatsApp importado do ADR**, a pedido do titular. Os 523 arquivos de sessão copiados (371.167.097 bytes, sem caches dispensáveis) foram comparados por SHA-256. O perfil anterior do Bira foi preservado em `%LOCALAPPDATA%\BiraWorkspace-MigrationBackups\2026-11-17T17-24-03-057Z\before`. Os dados do ADR não foram alterados pelo importador.

Na verificação real, o WhatsApp rejeitou o token BiraWorkspace no User-Agent. A correção remove somente esse token e o do Electron, preservando a versão real do Chromium e o sistema operacional. Os 12 testes do módulo passaram e o pacote foi recompilado. Depois da correção, **as duas sessões abriram autenticadas e online no executável Bira, sem QR code**. Não houve envio de mensagens. Evidências locais: `.test-results/whatsapp-migration.json` e `.test-results/whatsapp-migration-runtime.json`. Isso valida a transferência e a autenticação; chamadas e cobertura visual completa continuam pendentes.

## Registro da validação inicial (antes da importação)

Data: 17/11/2026. Windows deste PC, Node portátil 22.23.5, pnpm 9.15.9, Electron CastLabs 44.1.0. Base: ADRWorkspace 0.1.53, commit `5c19a7b`.

## Origem e isolamento

Plano encontrado no Google Drive: [PLANO-BIRA-WORKFLOW.md](https://drive.google.com/file/d/14xvxJD2XG2FsuXQYiHrSPJ-3KhOzmQ4f/view), copiado integralmente para esta pasta. O plano usa o nome Bira Workflow; este candidato usa BiraWorkspace, conforme solicitado.

Checkout original: `C:\Users\ubira\Downloads\ADR-repos\adrworkspace`, preservado sem alterações. Implementação independente em `C:\Users\ubira\Downloads\ADR-repos\biraworkspace`, branch `codex/biraworkspace`. Não houve push, publicação, instalação sobre ADR ou importação de contas. O perfil do executável é `%APPDATA%\BiraWorkspace`; desenvolvimento usa `BiraWorkspace Dev`. Os testes de runtime usam perfis descartáveis em `.test-results`.

## Verificações automatizadas

| Verificação | Resultado e alcance |
|---|---|
| Compilação, TypeScript e ESLint | Aprovados no código da migração |
| Suíte de testes | 777 testes: 620 desktop e 157 nos demais pacotes |
| Produto real em Electron | Inicialização, perfil, serviços sem gate CRM, criação/troca de workspace, configurações e atualizador desligado |
| Privacidade em DOM sintético | Máscara, botão visível, clique confiável, rejeição de clique sintético, expiração de cinco segundos, revogação na mutação, cobertura em DOM desconhecido, apresentação, retorno a Normal e persistência |
| PIN em Electron | Criar, confirmar e desbloquear; desbloqueio preserva a apresentação coberta |
| Rede em Electron | Cancelamento de resposta HTTP de erro com corpo grande |
| Navegação por notificação | Fixture de contatos, busca, carregamento atrasado e encaminhamento para foco/PIN; não valida notificações reais do Windows |
| Backup/restauração | Script PowerShell real; arquivos sintéticos de estado/cofre/partição restaurados e comparados por SHA-256; cache descartado |
| Pacote Windows | Executável `win-unpacked` abriu, carregou shell e confirmou identidade/perfil Bira e updater desligado |

O teste de interação encontrou e corrigiu uma regra CSS que escondia também o botão de revelação. O teste de PIN foi corrigido para observar o próximo diálogo, sem aguardar uma resposta JavaScript no renderer já destruído. Não foram capturadas telas ou usados dados reais nos fixtures.

Evidências: `.test-results/final-validation.log`, `personal-runtime.json`, `backup-restore.json`, `package-runtime.json`, `package-final.log`, `dependency-audit.json`. O pacote não é um instalador homologado: o teste usou o diretório completo `win-unpacked`.

## Pendências que impedem considerar o plano integralmente concluído

- Validar o WhatsApp atual com conta real: lista, busca, grupos, mídia, stickers, áudio, documentos, legendas, respostas, edição, seleção e conteúdo dinâmico. O adaptador atual é inicial; reconhecer dois elementos da página não demonstra cobertura de todos os layouts. Usar Apresentação para cobrir a view inteira em situações sensíveis. Não tratar a máscara como isolamento contra o próprio site.
- Validar login e persistência de múltiplas contas Google/Microsoft/WhatsApp, restauração de sessões reais, chamadas, permissões, câmera, microfone, compartilhamento e notificações nativas.
- Homologar Spotify/DRM e assinatura VMP. O empacotamento local não foi assinado e não altera configurações de segurança do Windows.
- Auditoria de dependências: 4 ocorrências críticas, 52 altas, 72 moderadas e 12 baixas. As críticas incluem tar, tinypool e shell-quote. O relatório mistura ferramentas de desenvolvimento/empacotamento e dependências; não há comprovação de que todas alcancem o executável. Exige atualização/triagem antes de distribuir.
- Otimizador Rust omitido do pacote e da interface; testes Rust não executados.
- Remoção física de todos os módulos legados, preferências portáveis, contatos/reuniões independentes do CRM, apresentação automática e IA continuam pendentes. As integrações ADR foram retiradas do caminho pessoal e as requisições ao domínio ADR são bloqueadas, mas código legado ainda existe no repositório/bundle.

## Roteiro interativo neste PC

1. Abrir `Iniciar BiraWorkspace.cmd` e entrar nos serviços diretamente. Para conectar WhatsApp, deixar o modo Normal até concluir o QR code.
2. Criar uma segunda conta/workspace e confirmar que cookies/sessões ficam separados. Fechar e reabrir para verificar persistência.
3. Na sessão WhatsApp, ativar PIN e testar PIN errado/correto, troca de conta, inatividade, reinício e recuperação. Confirmar que o PIN não muda a privacidade visual.
4. Exercitar os conteúdos listados acima no modo Discreto. Verificar revelação temporária, mudança de conversa, saída de foco e suspensão. Qualquer conteúdo que escape exige correção do adaptador; Apresentação cobre a view inteira.
5. Fazer uma chamada de teste, concedendo as permissões desejadas, e verificar câmera, microfone, áudio e compartilhamento. Conferir as notificações com Normal/Discreto/Apresentação.
6. Testar backup pelo painel após configurar uma pasta própria. A restauração automatizada atual comprova cópia de arquivos sintéticos; não comprova recuperação de cookies ou credenciais reais em outro Windows.

Não há envio automático de mensagens nos testes. A validação com contas reais requer intervenção do titular para autenticar os serviços e confirmar os resultados visuais.
