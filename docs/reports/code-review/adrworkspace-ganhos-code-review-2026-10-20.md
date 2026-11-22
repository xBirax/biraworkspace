# ADR Workspace — ganhos medidos da execução do code review

Data: 2026-10-20
Branch: `fix/code-review-2026-10-20` (5 commits sobre `teste-0.1.53-test.4`, `36bcee7`)
Review de origem: `adrworkspace-code-review-geral-2026-10-20.md`

## Como foi medido

- App real (o mesmo `index.bundle.cjs` do pacote) rodando com **perfil temporário**, a janela fora
  da tela e sem foco. Nenhuma conta real foi usada.
- **CRM simulado** em HTTPS local, que responde como logado. Os outros serviços (WhatsApp, Gmail,
  ChatGPT, Notion, Trello, Claude) carregaram da rede real, na tela de login.
- O mesmo roteiro rodou contra a versão anterior (**base**, 2 rodadas) e a nova. A nova teve
  3 rodadas: 2 com os lotes 1–3 e 1 com o build final.
- Os números vêm de `app.getAppMetrics()`. *Working set* é a soma de todos os processos, como no
  Gerenciador de Tarefas, e conta páginas compartilhadas. *Privada* é a memória exclusiva de cada
  processo. A variação entre rodadas iguais ficou em ±3–6 %.

Cenários:

1. **Abertura:** 45 s depois de abrir o app.
2. **Configurações:** abrir e fechar.
3. **Prompt:** abrir e cancelar um prompt.
4. **Trocas de workspace:** 3 trocas, clicando no WhatsApp de outro workspace na lateral.
5. **Teto de 3 serviços:** limite em "Serviços mantidos em memória" e 5 serviços abertos em
   sequência. Medido logo depois e 2min50s depois.

## Resultados

| Cenário | Base (média) | Depois (média) | Diferença |
|---|---|---|---|
| Abertura — processos | 9 | 8 | **−1 processo** (Configurações não carregam no boot) |
| Abertura — working set | 1.018 MB | 987 MB | dentro do ruído (o WhatsApp domina) |
| Após o prompt — páginas vivas | 6 | 5 | **renderer do prompt liberado** |
| 3 trocas de workspace — processos | 13 | 11 | **−2 processos** |
| 3 trocas de workspace — CRM carregado | 1 | **0** | o CRM não carrega mais à toa |
| 3 trocas de workspace — working set | 1.676 MB | 1.576 MB | **−100 MB (−6 %)** com o CRM simulado; o CRM real pesa mais (o código estima 400–700 MB) |
| Teto 3, depois de 2min50s — páginas carregadas | 14 | **9** | o teto passou a agir |
| Teto 3, depois de 2min50s — processos | 24 | 18 | **−6 processos** |
| Teto 3, depois de 2min50s — memória privada | 1.773 MB | 1.322 MB | **−451 MB (−25 %)** |
| Teto 3, depois de 2min50s — working set | 3.700 MB | 2.754 MB | **−946 MB (−26 %)** |

Lateral "Em cima/Embaixo" com a barra expandida, com 10 botões:

| Posição | Base | Depois |
|---|---|---|
| Em cima | 10 botões fora da tela, largura de rolagem 3.363 px numa janela de 1.843 px | 0 fora da tela, sem rolagem |
| Embaixo | 10 botões fora da tela, largura de rolagem 8.397 px | 0 fora da tela, sem rolagem |

Leitura: o ganho grande é o do teto de abas. Quem abre vários serviços ao longo do dia passa a ter
os mais antigos hibernados 90 s depois de sair deles. Antes, eles só hibernavam depois de 10 min,
mesmo acima do limite. O segundo ganho é a troca de workspace, que deixa de carregar o CRM a cada
clique.

## Qualidade

| Item | Antes | Depois |
|---|---|---|
| Testes | 746 | **758** (+12, cada um cobrindo uma correção) |
| Typecheck / lint | passa | passa |
| Cobertura do main (script `coverage`) | excluía `workspace-window.ts` e `index.ts` (≈7.700 linhas sem teste) | **40,5 %** com eles: o número real |
| Pastas em `vendor/` (vão para o instalador) | 8 versões da extensão | 1 (0.15.5) |
| Pacotes e scripts mortos | `crm-whatsapp-ui` + 17 `verify-refinement-*` | removidos |

## O que foi corrigido, por lote

1. **Bugs do dia a dia** (`b216ef4`)
   - Atualização instalando no meio de chamada.
   - Processo zumbi quando o boot falha.
   - Logout do Google recarregando Browser, Spotify e Meet.
   - Sonda do Meet perdida.
   - Link do Meet/Teams de outro workspace.
   - Horário silencioso fazendo o site ler "notificação bloqueada".
   - Bitwarden apagando as senhas espelhadas.
   - Prompt de senha mostrando texto de PIN.
   - Enter confirmando ação destrutiva.
   - Contador do Gmail ao trocar de conta.
2. **RAM** (`d733afb`)
   - Troca de workspace sem passar pelo CRM.
   - Teto de abas funcionando.
   - Configurações sob demanda.
   - Prompt e mini-barra fechando depois do uso.
   - Windows bloqueado contando como ninguém olhando.
   - Ouvinte de log HTTP com prazo.
   - Barra do Browser sem partição própria.
3. **Interface** (`d618d00`)
   - Foco do teclado ao fechar overlays.
   - Lateral horizontal.
   - Contraste AA no tema claro.
   - Tema aplicado no carregamento.
   - Toast fora da lateral.
   - Prompt abaixo da titlebar.
   - Tamanho da interface na paleta, nas notificações e no prompt.
   - Rolagem da paleta.
   - Véu do serviço hibernado.
   - Aba Privacidade sem estilos inline.
   - Microcopy.
4. **Segurança e robustez** (`9ac1c3f`)
   - Rotas do CRM abertas por páginas de terceiros.
   - CRM que sai para fora por redirect.
   - Backup do Electron 44 e perfil em junction.
   - Estado tolerante a downgrade.
   - PIN "corrompido" por arquivo preso.
   - Cofre com sufixo público.
   - `.svg` abrindo por padrão.
   - Histórico sobrescrito.
   - Lembretes atrasados.
   - Card da Lusha.
   - Laço do Gmail.
   - DevTools após bloquear o WhatsApp.
   - Painéis do shell que caem.
   - Ctrl+K e Ctrl+H.
   - Notificações sem prazo.
   - Agendamento.
   - Restaurar workspace.
5. **Dívida** (`049097c`)
   - Limpeza de pacote, scripts e `vendor/`.
   - Cobertura honesta.
   - Regra de atualização extraída para `update-policy.ts` com teste.
   - Docs alinhadas.

## O que ficou de fora, e por quê

- **Decisões de produto, sem mudança:**
  - Teams e Outlook continuam sempre acordados (1.3). Mudar isso para o contador deles.
  - O bloqueador de anúncios continua em todas as sessões (1.10).
  - O autoplay continua liberado para qualquer site.
  - O filtro de convite em agenda secundária continua como está.
- **Fontes WOFF2/subset:** não feito. O formato não muda a RAM, porque a fonte é decodificada
  igual. O subset esbarra em dúvida sobre o que a licença Ubuntu permite, e o ganho seria de
  poucos MB.
- **`privateBytes` em vez de working set na pressão de memória:** não feito. No Windows o
  `privateBytes` é *commit*, não "memória ativa", então não está claro que é melhor.
- **Fechar a barra do Browser sem abas, `console-message` por tipo de serviço e uma ordem única
  dos botões dos diálogos:** ganho pequeno demais para o risco.
- **Prettier em massa (142 arquivos):** não feito, porque geraria conflito com as branches
  `feat/*` abertas. Vale fazer num commit isolado depois de mesclá-las.
- **`@adr/crm-chrome-adapter`:** mantido. O review o chamou de morto, mas ele gera a extensão
  do Chrome publicada em `extension-updates/`.
- **Quebrar o `workspace-window.ts` (7.196 linhas):** só começou, com a regra de atualização.
  O resto continua sendo a maior dívida do repositório.
- **Backup do Electron 44:** mudou de comportamento. Se a pessoa apagar a pasta de backup, a
  cópia não é refeita. Antes era refeita a cada abertura e podia fechar o app por falta de
  disco.

## Precisa de conferência na tela

Estes itens não têm teste automatizado que os exercite de verdade:

- **Ctrl+K num campo de texto** (Gmail, Outlook, Notion): o atalho é devolvido à página por
  `sendInputEvent`.
- **Login do Google dentro da aba do CRM:** a guarda nova de `did-navigate` libera `google.com`
  e `youtube.com`.
- **Foco no prompt de PIN:** o PIN digitado tem de ir para o prompt sem precisar clicar.
- **Mini-barra do Meet:** tem de voltar ao sair da aba durante uma chamada.
- **Toast:** passa a aparecer no canto da área dos serviços.
- **Tema claro:** não pode mais piscar escuro ao abrir.
- **Paleta, notificações e prompt:** conferir com "Tamanho da interface" acima de 100 %.

## Observação de ambiente

Durante a limpeza do lockfile, um `pnpm install --offline` apagou o `node_modules`. Ele foi
restaurado com `pnpm install` e `node scripts/ensure-electron.mjs`. Depois disso, build,
typecheck e testes passaram.
