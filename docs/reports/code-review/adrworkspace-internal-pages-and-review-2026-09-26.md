# ADR Workspace — páginas internas e revisão geral

Data: 2026-09-26
Base: `v0.1.43-rc.1` (`e8aeb0a`)
Checkout isolado: `/tmp/adrworkspace-native-full`, branch `codex/internal-usability-review`

## Escopo percorrido

Leitura guiada pelas entradas e dependências: shell e páginas internas; estado e workspaces;
IPC e preloads; views de CRM e serviços; perfis Google e partições; navegação, permissões,
downloads, notificações, hibernação e recuperação; atualizador, empacotamento e ferramenta
de otimização do Windows. Isto é uma revisão de fluxos e pontos de risco, não uma prova de
ausência de bugs em cada linha do monorepo.

## Usabilidade das páginas internas

| Área | Mudança |
|---|---|
| Serviços | Busca, contagem, estado por conta e uma ação principal clara. Renomear, mover, hibernar, associar conta Google e remover ficam em “Gerenciar”. O CRM aparece como item integrado, com mover e áudio. O menu se reposiciona perto do rodapé. |
| Geral | Campos em edição não são sobrescritos por atualizações frequentes de estado. |
| Aparência | Posições da barra têm prévias visuais e seleção acessível. |
| Perfil e contas | Identidade do workspace, sessões Google e saída de conta têm apresentação e rótulos mais claros. |
| Notificações e privacidade | Ajuda contextual, nomes acessíveis, foco restaurado após atualização e reversão visual quando uma preferência falha. |
| Downloads e feed | Estados traduzidos; feed e listas deixam de reconstruir o DOM quando a mudança recebida não os afeta. Isso preserva foco e reduz repinturas. |

Arquivos principais: `apps/desktop/src/shell/panel.html`, `panel.css` e `overlay.html`.

## Achados corrigidos

| Gravidade | Reprodução e impacto | Correção |
|---|---|---|
| P1 | Remover o último WhatsApp e reabrir o app recriava a conta. Se todos os workspaces fossem removidos, a recuperação também podia reutilizar o perfil CRM padrão de um workspace antigo. | `service-catalog.ts:97`: semear WhatsApp somente quando o workspace é criado; preservar o workspace ativo válido e usar perfil CRM novo ao recriar após exclusão. |
| P1 | Ao restaurar uma partição, um destino já existente era apagado antes da movimentação. Uma sessão criada ou recuperada no intervalo podia perder dados. | `packages/partitions/src/index.ts:68`: falhar de forma explícita se o destino existir, preservando as duas cópias para recuperação manual. |
| P1 | Uma operação IPC recebia um ID válido de serviço ou conta de outro workspace e podia alterar a sessão errada. | `workspace-window.ts:2908` e `google-services.ts:242`: exigir pertencimento ao workspace ativo nas mutações de serviços, contas Google e PIN WhatsApp. |
| P2 | Adicionar Gmail pela primeira vez criava Gmail e Calendar, mas abria o último serviço criado, Calendar. | `workspace-window.ts:2984`: abrir o serviço do tipo selecionado. |
| P2 | Falha de carga podia gerar reloads sem limite; crash repetido da view podia entrar em recuperação contínua. | `workspace-window.ts:2128` e `:2249`: limitar tentativas, expor falha e oferecer “Tentar novamente”. |
| P2 | Sugestão de download com espaço ou ponto final podia virar `.exe` após saneamento, mas a decisão de abrir automaticamente usava o nome original. | `downloads.ts:38`: classificar o caminho realmente salvo; tratar erro de abertura. |
| P2 | Reordenação de workspaces com IDs repetidos duplicava registros; renomear ID ausente retornava sucesso silencioso. | `packages/workspaces/src/index.ts:40` e `:55`: validar alvo e deduplicar ordem. |
| P2 | Comparação lexical de pré-release tratava `rc.10` como anterior a `rc.2`. | `update-policy.ts:39`: comparar identificadores numéricos numericamente. |
| P2 | URL externa `https://usuario:senha@host/` podia sair do app com credenciais embutidas. | `url-allowlist.ts:3`: rejeitar userinfo. |
| P2 | Resposta HTTP de erro na consulta de releases ficava com corpo aberto; o histórico de falha Undici justifica fechar a resposta. | `update-policy.ts:117`: cancelar o corpo antes de retornar. |

## Achados ainda abertos

| Prioridade | Evidência e impacto | Encaminhamento |
|---|---|---|
| P1 — segurança, bloqueia publicação estável desta revisão | `system-boost.ts:31-53` copia script e configuração para `%LOCALAPPDATA%\ADRBooster`, editável pelo usuário, e `:86-91` executa esse script elevado após UAC. `WorkstationBoost.ps1:300-336` também restaura valores de registro a partir de `backup.json` no mesmo local, sem limitar as chaves. Um programa com acesso à conta local pode alterar esses arquivos antes da confirmação de UAC e induzir execução ou escrita elevada. | Substituir o fluxo por helper assinado e protegido, ou redesenhar as ações para não elevar código nem confiar em backup editável. Validar em Windows com UAC e preservar a possibilidade de desfazer otimizações antigas antes de publicar. Uma checagem de hash feita no processo comum não elimina a janela de troca de arquivo. |
| P2 — dependências | Auditoria do lockfile em 26/09 retornou 2 avisos críticos, 37 altos, 40 moderados e 6 baixos. Os críticos apontam `tar` no ferramental de build e `vitest` UI de desenvolvimento; há aviso alto para `builder-util-runtime` ligado a redirecionamento com cabeçalhos de autenticação. O atualizador configurado usa releases públicos, mas o grafo precisa de atualização e reavaliação do pacote produzido. | Atualizar dependências em rodada própria, conferir advisories aplicáveis ao runtime empacotado e repetir auditoria. |

## Validação e limites

`corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build` e
`git diff --check` passaram neste checkout. Não foram executadas suítes de testes,
smoke visual de Electron, instalador Windows nem login real em CRM, Google ou WhatsApp.
As sessões instaladas no desktop não foram tocadas. Não houve commit, tag ou publicação.
Antes de disponibilizar uma atualização, conferir foco/menus em 80%–200%, conta e
workspace, instalação e atualização no Windows, persistência de sessão e o bloqueio P1.
