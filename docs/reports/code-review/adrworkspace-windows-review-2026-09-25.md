# ADR Workspace — revisão pré-publicação Windows

Data: 2026-09-25

Base revisada: `main` em `e6063aa` (pacote `0.1.36`)
Escopo: correção de ícone/contador da barra de tarefas, revisão estática de riscos P0/P1 e pipeline Windows RC. A etapa de redesign funcional está em progresso e não faz parte da avaliação visual desta rodada.

## Resumo

Foram confirmados dois achados P1 e três itens P2. As correções estão no diff de trabalho; nenhum release/tag foi publicado nesta revisão. O pacote `0.1.36` deve primeiro sair como candidato `-rc.N`, passar smoke visual e upgrade em Windows, e só então receber tag estável.

## Achados

| Severidade / estado | Evidência e reprodução | Impacto | Localização |
|---|---|---|---|
| P1 — corrigido | Antes, o contador era atualizado somente por `app.setBadgeCount`, API sem integração na barra de tarefas do Windows. Reproduzir recebendo mensagens não lidas em Windows e observar a janela fixada: o número não era desenhado. A alteração usa `setOverlayIcon` no Windows e mantém `setBadgeCount` nas plataformas suportadas. | O usuário não via as mensagens não lidas no ícone da barra. | `apps/desktop/src/main/workspace-window.ts:1029-1045`; raster/testes em `taskbar-badge.ts` e `taskbar-badge.test.ts`. **Windows visual ainda não validado.** |
| P1 — corrigido | Dois eventos `will-download` simultâneos para `report.pdf` podiam executar `existsSync` antes de Chromium criar arquivo. Ambos escolhiam o mesmo caminho. Reprodução determinística: duas alocações contra `exists=()=>false`, sem materializar arquivo entre chamadas. Agora o caminho fica reservado até `done`, e o segundo recebe `report (1).pdf`; a chave normaliza caminho absoluto e caixa em Windows. | Colisão ou falha de um download concorrente; possível perda de arquivo. | `apps/desktop/src/main/download-policy.ts:32-62`; integração em `apps/desktop/src/main/downloads.ts:103-128`; cenários em `download-policy.test.ts`. |
| P2 — corrigido, visual pendente | O PNG de build anterior era 512×512 com wordmark ocupando pequena fração do canvas. PNG é aceito pelo electron-builder; não há evidência de que o formato causasse a falha. Novo ICO tem múltiplos tamanhos e o runtime usa composição dedicada. | Melhor legibilidade em executável e atalhos; só a inspeção dos atalhos reais pode excluir falha Windows. | `apps/desktop/package.json:41-80`; `apps/desktop/build/icon.ico`; `apps/desktop/src/shell/taskbar-icon.png`; inclusão em `apps/desktop/scripts/copy-preload.mjs:34-63`; seleção no `workspace-window.ts`. |
| P2 — corrigido, CI pendente | Não havia caminho de candidato avaliável sem risco de publicar como stable. Workflow aceita `vX.Y.Z-rc.N`, valida versão core contra pacote, carrega artefatos e marca pre-release; publicação stable exclui RC. Nome da tag chega a PowerShell por variável de ambiente e só é consumido após validação regex; nenhum ref controlado pelo evento é interpolado no script. | Permite testar instalador e upgrade antes da promoção estável. Workflow ainda não rodou no GitHub Actions. | `.github/workflows/release-windows.yml`; teste de contrato em `apps/desktop/src/main/ci-config.test.ts`. `electron-updater` mantém `allowPrerelease=false`. |
| P2 — corrigido | Lint marcava nomes DOM como indefinidos no `composer-preload.cjs`, que executa com DOM. Escopo de globals limitado a esse arquivo. | Lint volta a passar sem ocultar erros de outros preloads. | `eslint.config.js:58-61`. |

## Áreas revisadas

- IPC e preloads: validação de payload, canais registrados, origem/sender e janela principal nas rotas CRM/composer.
- Navegação, permissões e sessões CRM por workspace: criação/isolamento de views e navegação externa.
- Estado persistido, backup e recuperação: escrita atômica e comportamento após falha de flush.
- Cofre de credenciais e PIN WhatsApp: `safeStorage`, comparação de PIN e persistência.
- Downloads: sanitização, extensões executáveis, seleção de caminho, concorrência e ciclo de vida.
- Notificações, hibernação e encerramento: contagem, badges e suspensão/retomada de views.
- Updates: validação de versão/artefato, sem downgrade, pré-release desabilitado e instalação automática desligada após sair.
- Empacotamento e CI: assets copiados, ícones, artefatos Windows e fluxo de candidato RC.

## Gaps e limitações explícitos

1. Revisão estática guiada por caminhos de risco; não foi leitura linha a linha de todos os arquivos do repositório.
2. Sem logins reais em CRM, WhatsApp, Google ou Lusha; sem envio de mensagens nem teste com contas do usuário.
3. Ambiente local Linux não tem `wine`/`wine64`. O empacotamento local Windows parou antes do NSIS por falta do `electron.exe` Windows esperado (`ENOENT ... electron.exe -> adr-workspace.exe`); não há instalador Windows validado localmente.
4. Faltam execução do workflow RC em `windows-latest`, inspeção do instalador e smoke em Windows de instalação limpa e upgrade desde `0.1.35`: executável, atalhos Desktop/Start, atalho fixado e overlays em `0`, valor comum e `99+`.
5. Redesign ainda requer avaliação de fluxo completo em todos os serviços, contas/workspaces, login persistente, PIN/recovery, temas, escala 80–200% e regressão Linux.

## Gates conhecidos

No último ciclo antes da ampliação do redesign, `pnpm build`, `pnpm typecheck` e `pnpm lint` passaram. A suíte completa terminou com os 170 testes do Desktop passando e os pacotes anteriores também sem falhas; `git diff --check` passou. Testes focados após reserva case-insensitive passaram 17/17. Os gates devem ser repetidos depois dos hunks finais de escala e rota de settings. O shell e o painel passam `node --check` sobre seus scripts inline. `dist/shell/taskbar-icon.png` existe (PNG RGBA 512×512); `build/icon.ico` é recurso Windows com nove imagens multirresolução. Não publicar tag estável enquanto a validação Windows estiver pendente.

## Progresso do redesign separado (.37)

O trabalho ainda não está concluído. O shell já diferencia serviço carregando, falha recuperável e hibernação real (serviço nunca aberto não é chamado de hibernado), expõe estado e não lidas em nomes acessíveis, oferece reorder por `Alt+Shift+seta` além do drag, aplica escala configurada à barra e abre diretamente `Serviços` ou `Geral` conforme a ação. Falta validar visualmente os fluxos com renderer real, rever feedback do restante das ações do painel e smoke de login/serviços, acessibilidade, temas, 80–200% e regressão Linux. Esses hunks ficam fora do candidato `.36`.
