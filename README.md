# BiraWorkspace — candidato local

Versão 0.2.0-local.1 para testes neste Windows. Derivada do ADRWorkspace 0.1.53 (5c19a7b), em uma pasta independente. A documentação anterior está em [docs/README-ADR-ORIGINAL.md](docs/README-ADR-ORIGINAL.md) e descreve o produto de origem, não esta versão pessoal.

## Abrir neste PC

Dê dois cliques em **Iniciar BiraWorkspace.cmd** nesta pasta. O executável fica em `apps/desktop/release/win-unpacked/biraworkspace.exe`; mantenha a pasta `win-unpacked` inteira.

O perfil pessoal é `%APPDATA%\BiraWorkspace`. O modo de desenvolvimento usa `%APPDATA%\BiraWorkspace Dev`. Nenhum perfil ADR foi importado ou substituído. Faça login diretamente nos serviços desejados; não há login no CRM.

Use o botão de olho **Privacidade** para ativar o desfoque e escolher categorias por sessão. Passe o mouse para revelar ou escolha segurar Alt. **Ocultar agora** cobre todas as sessões, com um botão para voltar às preferências anteriores. O PIN continua separado. Veja [o guia do redesenho](docs/PRIVACIDADE-REDESENHO.md).

## Repetir as verificações

Execute `Testar BiraWorkspace.ps1` pelo PowerShell. O script usa o Node portátil em `.tools`, compila, verifica tipos/lint, roda testes e abre fixtures Electron com perfis descartáveis. Os testes de backup usam somente arquivos sintéticos. Resultados ficam em `.test-results`.

## Escopo e limites

- Inicialização pessoal, identidade própria, perfis separados, CRM fora do fluxo, extensão ADR não empacotada e atualizador desligado.
- Privacidade visual inicial, PIN preservado, correções de backup, histórico corrompido e bloqueio do Bitwarden.
- Este pacote é para teste local, sem assinatura de distribuição/VMP. Spotify/DRM não está homologado. Otimizador nativo foi retirado desta versão.
- Contas reais, chamadas, câmera/microfone, compartilhamento de tela e cobertura do WhatsApp atual ainda precisam de validação interativa. A máscara visual não é uma fronteira contra scripts do próprio site ou ferramentas de desenvolvimento.
- A auditoria de dependências ainda apresenta alertas. Não é uma versão aprovada para distribuição.
- Código legado permanece no repositório. Importação/exportação de preferências, contatos/reuniões independentes do CRM, detecção automática de apresentação e recursos de IA são etapas pendentes do plano.

Veja [docs/VALIDACAO-LOCAL.md](docs/VALIDACAO-LOCAL.md) e [docs/PLANO-BIRA-WORKFLOW.md](docs/PLANO-BIRA-WORKFLOW.md). Os workflows antigos estão desativados e o remoto não permite push.
