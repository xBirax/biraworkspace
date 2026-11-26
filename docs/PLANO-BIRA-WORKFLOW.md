# Bira Workflow — auditoria e plano de transformação

Data: 17/11/2026. Base: ADRWorkspace 0.1.53, commit `5c19a7b`. Uso previsto: uma pessoa no Windows, com múltiplas contas e serviços. Esta entrega é uma revisão e um plano; o aplicativo e os repositórios remotos não foram alterados.

## Recomendação

Criar um aplicativo desktop independente, local por padrão, sem conta Bira e sem autenticação ADR. Reaproveitar Electron, sessões, navegação, PIN, hibernação e testes. Remover as integrações ADR do produto pessoal; funcionalidades úteis hoje acopladas ao CRM ganham implementações locais ou provedores próprios em etapas posteriores.

O login de WhatsApp, Google, Microsoft e outros serviços continua necessário. “Sem login no CRM” não elimina a autenticação desses sites. GitHub hospedará código e instaladores; o aplicativo continuará rodando no computador, não será convertido em site.

Manter múltiplos workspaces/contas, mesmo para um usuário: pessoal, Lockstock e outros contextos podem precisar de cookies separados. Não criar sistema de usuários, equipes, permissões empresariais ou servidor próprio só para substituir o CRM.

Escopo de aceite: abrir sem ADR, executar em identidade e perfil próprios, não chamar APIs ADR automaticamente, preservar serviços úteis, oferecer privacidade visual verificável e distribuir exclusivamente pelo destino Bira. As melhorias de IA são opcionais e não condicionam esse aceite.

## O que foi verificado

Leitura dirigida dos caminhos de inicialização, bloqueio CRM, IPC, chamadas remotas, injeção WhatsApp, notificações, permissões, PIN, persistência, histórico, backup, Bitwarden e publicação. Consulta do histórico Git para termos de privacidade e padrões de CSS blur. Leitura da marca local do Bira Flow em `D:/Projetos/2026-10-21/bira-flow/biraflow/branding.py` e imagens de referência.

Validação executada no checkout original, sem alterações em arquivos versionados:

| Verificação | Resultado |
|---|---|
| Instalação com lockfile congelado | Passou |
| Build de todos os pacotes | Passou |
| Typecheck | Passou |
| ESLint | Passou |
| Testes | 83 arquivos, 772 testes aprovados; 615 no desktop |
| Auditoria de dependências | Retornou alertas; saída bruta preservada |

Os testes são predominantemente unitários e de contratos, alguns extraindo funções do código. Eles não demonstram que WhatsApp, notificações nativas, instalador e restauração funcionam hoje com contas reais. Não foram executados o instalador, os testes Rust, os smokes Electron de release ou uma navegação autenticada. Não houve auditoria exaustiva linha por linha de todos os módulos, do backend ADR, das dependências ou de todo o vendor.

Logs nesta pasta: `build.log`, `typecheck.log`, `lint.log`, `tests.log`, `dependency-audit.json`.

## Code review: correções e impedimentos à migração

Os itens rotulados como “migração” são comportamentos legítimos do ADR que precisam mudar no Bira; não são apresentados como defeitos do produto original. P1 = resolver antes da primeira distribuição pessoal; P2 = próxima etapa de confiabilidade.

### 1. P1 — O CRM controla o acesso a todos os serviços [migração]

**Evidência:** `apps/desktop/src/main/workspace-window.ts:2531`, `:2679`, `:7230`; `crm-login.ts:67`.
**Comportamento:** abrir WhatsApp sem cookie CRM válido redireciona ao CRM. Boot, troca de workspace, mudança de cookies e notificações participam desse controle.
**Correção:** remover o gate e seus timers/listeners; abrir último serviço válido ou início local. Remover a superfície CRM e revisar recuperação/atalhos. Não simular login retornando `true`.
**Se ignorado:** o aplicativo continua dependente da ADR ou reabre o CRM em caminhos menos óbvios. Testar boot sem cookies, offline, troca de workspace e clique em notificação.

### 2. P1 — Recursos aparentemente locais usam APIs ADR [migração]

**Evidência:** `apps/desktop/src/main/index.ts:202`, `:292`, `:487`, `:524`, `:559`; `crm-transcript-cache.ts:29`; `workspace-window.ts:4159` e handlers Lusha ao final do arquivo.
**Comportamento:** tradução, transcrição, respostas rápidas, pesquisa de contatos/negócios, assistente Gmail e Lusha dependem de cookies/rotas CRM. Até o cache de transcrições revalida a sessão no servidor.
**Correção:** inventário por recurso e remoção efetiva das chamadas. Respostas rápidas passam a arquivo local. IA será configurável depois. Lusha e registro CRM ficam ausentes no MVP.
**Se ignorado:** a janela abre, mas botões falham, pedem login ou continuam enviando conteúdo à ADR. Teste de rede deve comprovar zero requisições automáticas aos domínios ADR.

### 3. P1 — Atualização e instalação ainda pertencem à ADR [migração]

**Evidência:** `apps/desktop/package.json` campos `build.appId`, `publish`, `productName`; `src/main/index.ts` AUMID; `.github/workflows/release-windows.yml`; `build/installer.nsh:9`; `build/backup-profile.ps1:20`.
**Comportamento:** identidade Windows, atalhos, backup e release estão configurados para ADR. Apenas mudar a logo mantém essas ligações.
**Correção:** identidade própria, caminho de dados, nomes de artefatos, feed e repositório de releases. Inicialmente updater desativado até existir um destino Bira verificado. Credenciais de publicação exclusivamente no CI do novo repositório.
**Se ignorado:** risco de receber uma versão ADR ou operar a pasta errada. Validar instalação simultânea ADR+Bira, atualização Bira e desinstalação independente.

### 4. P1 — Dependências exigem atualização e triagem [segurança]

**Evidência:** `dependency-audit.json`, gerado nesta revisão; `apps/desktop/package.json` fixa Vitest 3.0.8 e Electron CastLabs 44.1.0+wvcus.
**Comportamento:** o audit retornou 98 registros de advisory e contagem agregada de 142 ocorrências: 5 críticas, 50 altas, 75 moderadas e 12 baixas. São contagens da ferramenta, não 142 falhas exploráveis comprovadas no aplicativo.
**Correção:** separar ferramenta de build/teste, código empacotado e runtime; atualizar grupos compatíveis e repetir build/testes. Há aviso confirmado para Vitest anterior a 3.2.6 quando o servidor UI/API está exposto; o comando `vitest run` usado aqui não prova essa exposição. O pacote raiz resolveu 3.2.7, mas o desktop mantém 3.0.8. Uniformizar versões. Para Electron, confirmar patches no fork CastLabs e retestar DRM, cookies, chamadas e upgrade de perfil.
**Se ignorado:** carregar vulnerabilidades conhecidas para o produto novo. Não aplicar atualizações forçadas indiscriminadas nem alegar que todo advisory npm se aplica ao binário CastLabs.

### 5. P1 — Privacidade visual não existe nesta versão [lacuna para o Bira]

**Evidência:** `workspace-window.ts:4189`, `shell/panel.html:1191`, `packages/app-state/src/index.ts`; buscas no código e histórico não localizaram implementação de blur de mensagens.
**Comportamento:** a privacidade implementada é bloqueio por PIN, com expiração e opções por sessão. Desbloquear permite ler a conversa normalmente.
**Correção:** criar proteção visual independente do PIN, com níveis, escopo por conta e revelação deliberada. Especificação abaixo.
**Se ignorado:** o pedido de borrar mensagens permanece sem atendimento. A busca negativa não comprova inexistência em outro repositório, branch não disponível ou versão externa.

### 6. P1 — Prévia oculta ainda mostra identidade [limitação de privacidade]

**Evidência:** `notifications.ts:35`, `:197`, `:233`; `workspace-window.ts:2785`; `permission-handler.ts` check de notificações.
**Comportamento:** `hidePreview` substitui `body` e remove `image`, mas o título original e outras opções, como ícone, continuam. É comportamento explícito do produto atual. O patch da página não cobre o código executado dentro de um service worker.
**Correção:** política única para tela e notificações; título genérico, corpo genérico, sem foto. No modo estrito, bloquear notificações de service workers que não possam ser sanitizadas e manter contador local. Não prometer sanitização universal só sobrescrevendo `window.Notification`.
**Se ignorado:** uma conta protegida pode continuar identificando remetentes fora da janela. Testar página, worker, app minimizado e central de notificações do Windows.

### 7. P2 — Backup anuncia agendamento antes de confirmar o processo [defeito]

**Evidência:** `profile-backup.ts:195–206`, `profile-ipc.ts:136–145`.
**Comportamento:** falha assíncrona de `spawn`, por exemplo PowerShell indisponível/bloqueado, cai em `child.on('error', () => undefined)`. A função já retornou sucesso, e o chamador pode fechar o app.
**Correção:** aguardar confirmação de inicialização e, preferencialmente, handshake do script pronto para esperar o app; só então encerrar. Comunicar falha sem fechar. O evento `spawn` sozinho não comprova conclusão do backup.
**Se ignorado:** o app pode fechar sem copiar nem reabrir. Reproduzir com runner falso emitindo `error` e outro que inicia mas falha antes do handshake.

### 8. P2 — Bitwarden não confirma que o cofre foi trancado [defeito]

**Evidência:** `bitwarden-cli.ts:136–138`.
**Comportamento:** o runner retorna `{code, stdout, stderr}`; o `finally` espera `bw lock`, mas descarta `code`. Timeout/erro de lock não invalida o sucesso da importação nem informa o usuário.
**Correção:** verificar o resultado, limpar referências locais à sessão e apresentar estado explícito de falha de bloqueio. Fazer tentativa limitada de recuperação sem esconder o erro original da importação.
**Se ignorado:** o usuário acredita que a CLI foi trancada sem confirmação disso. Testar importação bem-sucedida seguida de erro no lock e erro simultâneo de listagem/lock.

### 9. P2 — Janela central concentra decisões demais [manutenção]

**Evidência:** `workspace-window.ts`, 7.267 linhas; `shell/panel.html`, 1.703 linhas.
**Comportamento:** boot, CRM, serviços, PIN, notificações, permissões, cofres, reuniões e updater compartilham muitas variáveis de fechamento. Remover CRM afeta mais que um módulo.
**Correção:** extrair durante a migração somente as responsabilidades tocadas: política de acesso local, privacidade, integrações opcionais e identidade de distribuição. Manter um controlador da janela. Não reescrever toda a UI nem criar framework de plugins.
**Se ignorado:** alterações de privacidade continuarão difíceis de testar e sujeitas a regressões de navegação.

### 10. P2 — Testes verdes não garantem proteção no Electron real [cobertura]

**Evidência:** `workspace-runtime.test.ts` extrai funções via AST e transpila; `whatsapp-inject.test.ts` e vários testes de contrato verificam scripts/strings; CI de release possui smokes adicionais.
**Comportamento:** testes unitários não detectam um frame exposto antes da injeção, menu nativo com texto sensível ou mudanças reais do DOM do WhatsApp.
**Correção:** preservar testes existentes e adicionar poucos testes Electron reais com fixtures locais, além de roteiro manual com conta pessoal para homologação. Gravar evidências sem mensagens reais.
**Se ignorado:** pode haver falsa confiança no blur e na distribuição. Meta é testar os riscos, não aumentar percentual de cobertura por aumentar.

### 11. P2 — Ações pessoais estão presas ao painel de extensão ADR [migração]

**Evidência:** `whatsapp-inject.ts` procura `.crmwa-panel-head`; `extension-inject.ts` lê `vendor/adr-crm-extension-*`; vendor `content.js` usa `crmAuthState`.
**Comportamento:** salvar contato e agendar reunião dependem do cabeçalho do painel CRM para aparecer. Remover vendor pode remover essas ações úteis junto.
**Correção:** um painel pessoal pequeno e independente; extrair somente a identificação de conversa necessária, com testes. Preferir ações no chrome do app quando possível.
**Se ignorado:** funcionalidades desaparecem sem intenção. Não manter toda a extensão empresarial só para conservar dois botões.

### 12. P2 — “Abrir configurações” encaminha ao CRM [contrato a corrigir]

**Evidência:** `index.ts:554–557`, vendor `content.js:188`; guard normaliza `openOptions` para `openSettings`.
**Comportamento:** o comando chama `showCrmSurface`, não o painel local de configurações. No produto Bira sem CRM, esse destino deixa de existir.
**Correção:** novo comando explícito para configurações locais, com autorização do remetente. Remover o comando antigo com o painel ADR.
**Se ignorado:** botão fica morto ou reintroduz navegação ao CRM. Testar destino da ação, não apenas o nome do comando.

### 13. P2 — Diagnóstico não é anonimizado [limitação de privacidade]

**Evidência:** `diagnostics.ts:26` e `redact.ts`.
**Comportamento:** exporta caminho de usuário, nomes dos serviços e settings; regex remove padrões de segredo conhecidos, não todos os identificadores pessoais. Exportar não equivale a anonimizar.
**Correção:** modo padrão de diagnóstico mínimo com lista de campos permitidos, IDs substitutos e prévia antes de compartilhar. Segredos de futuros provedores nunca entram em settings exportáveis.
**Se ignorado:** relatório enviado a suporte pode revelar nomes de contas e caminhos locais. Não foi encontrado envio automático desse relatório.

### 14. P2 — Histórico ilegível pode ser substituído silenciosamente [recuperação]

**Evidência:** `browser-history.ts:230–275`.
**Comportamento:** erro de decrypt/parse zera memória; uma visita posterior pode gravar essa nova coleção por cima do arquivo original, caso a criptografia volte a estar disponível.
**Correção:** preservar cópia do arquivo ilegível antes da primeira sobrescrita, sinalizar recuperação e distinguir histórico vazio de falha de leitura. Aproveitar padrão de quarentena já usado pelo app-state.
**Se ignorado:** perde-se a chance de recuperar histórico potencialmente recuperável. Testar decrypt falhando uma vez e funcionando na gravação seguinte.

Pontos fortes a preservar: sandbox e context isolation ativados, nodeIntegration desativado nas views lidas; validação de origem e frame no IPC; escrita durável e recuperação do estado; isolamento de partições; PIN por sessão com limitação de tentativas; histórico cifrado; políticas de navegação e proteção de chamadas. Não remover essas proteções junto do login CRM. A recomendação de validar remetentes IPC também consta na [documentação Electron](https://www.electronjs.org/docs/latest/tutorial/security).

## Destino de cada recurso

| Atual | Bira Workflow |
|---|---|
| Login, tenant, negócio e contatos ADR | Remover do app pessoal |
| Contas WhatsApp, Google e Microsoft | Preservar logins próprios e isolamento |
| Browser, navegação externa e downloads | Preservar, renomear e testar |
| PIN por WhatsApp | Preservar e integrar à proteção visual |
| Tradução/assistente Gmail via ADR | Desativar controles no MVP; reintroduzir com provedor próprio |
| Transcrição que consulta mensagem já ingerida no CRM | Redesenhar entrada de áudio; não basta trocar URL |
| Respostas rápidas | Biblioteca local com categorias e busca |
| Reunião → registro no CRM | Nota/tarefa local opcional |
| Lusha via CRM | Remover inicialmente; integração pessoal posterior |
| Salvar contato / agendar reunião | Preservar fora do painel ADR, validar fluxo Google |
| Hibernação e proteção de chamada/edição | Preservar e medir |
| Bitwarden/cofre | Preservar com correção de bloqueio; evitar expandir gerenciador de senhas |
| Otimizador nativo | Manter apenas se build/teste viável; não expandir limpeza do Windows |
| Atualizações ADR | Substituir por canal Bira independente |

## Privacidade WhatsApp: especificação funcional

### Três níveis claros

1. **Normal:** conversa visível; respeita PIN e preferências normais de notificação.
2. **Discreto:** mensagens, prévias, nomes, fotos, mídias, documentos, citações e transcrições ocultos conforme opções por conta. Ao ativar pela primeira vez, ocultar todas essas categorias; mostrar identidade é escolha explícita. Usar desfoque forte onde útil, com máscara opaca disponível para texto curto e números.
3. **Apresentação:** conteúdo sensível coberto, identidade oculta, avisos nativos suprimidos e revelação individual desativada. Para ler uma mensagem, sair deliberadamente do modo. Botão persistente no app para sair do modo.

PIN é uma camada separada. Desbloquear uma conta não desativa seu modo discreto. A hierarquia é: conta bloqueada > apresentação > discreto > normal. Ao sair de uma reunião, restaurar o modo anterior só quando todas as apresentações internas terminarem; uma escolha manual feita durante a reunião prevalece.

### Revelação que não causa acidentes

- Nada de revelar apenas ao passar o mouse: um cursor parado deixaria a mensagem legível durante uma apresentação.
- Botão próprio “Revelar” por bloco, fora de links/reações, com suporte a teclado. Clicar revela por cinco segundos; “Manter pressionado” pode ser opção adicional. Não interceptar o clique normal que envia ou reage.
- Soltar, sair do bloco, perder foco, trocar de conversa/conta, hibernar, suspender ou bloquear o Windows cancela qualquer revelação. Escape esconde imediatamente.
- Ao reaproveitar um nó da lista virtualizada, não herdar o estado revelado da mensagem anterior. Chave inclui conta, conversa e identidade da mensagem; se identidade não for confiável, cancelar toda revelação na mutação relevante.
- O compositor e a mídia em visualização também entram na política. “Revelar compositor para escrever” é deliberado; não liberar todas as mensagens ao focar o campo.
- Atalho de privacidade configurável, com detecção de conflito e alternativa visível. Não escolher um atalho que concorra com ditado do Bira Flow sem verificar sua configuração.
- No modo apresentação, considerar substituir nomes reais das contas por aliases no sidebar e ocultar títulos de janela, tooltips e detalhes no menu de contexto.

### Implementação proposta

Preferências no schema versionado, por `serviceId`: modo padrão, categorias ocultas, intensidade/máscara, tempo de revelação, ocultação ao perder foco e política de notificações. Estado transitório de revelação fica só em memória. Identidade de sessão e decisões ficam no processo principal; a página não pode desligar a proteção via IPC.

Um módulo próprio (`whatsapp-privacy.ts` + preload/controlador isolado) aplica CSS e mantém um adaptador DOM pequeno. Não depender da extensão CRM. Reutilizar apenas seletores justificados e testar mudanças; preferir atributos semânticos com fallback, sem depender exclusivamente de classes geradas.

Antes de mostrar uma WebContentsView protegida, manter sua área coberta pelo shell/oculta. Liberar somente depois da confirmação do adaptador no documento atual. Navegação, reload e retomada de hibernação invalidam a confirmação. Mensagens novas devem nascer mascaradas por regras CSS que já estejam ativas; MutationObserver incremental cuida da classificação complementar, não um scan completo a cada evento.

Se os seletores não reconhecerem a página, continuar com cobertura ampla e mostrar “Proteção visual precisa de atualização”, com ação explícita para abrir sem proteção. O app não deve anunciar “Protegido” quando só conseguiu injetar um script. A confirmação é uma verificação funcional limitada, não prova contra um site hostil.

Apresentação deve poder cobrir toda a view com uma superfície do próprio aplicativo, sem depender do DOM remoto. Isso mantém um caminho seguro quando o WhatsApp muda. Preparar máscara antes de iniciar compartilhamento interno. Compartilhamentos iniciados fora do app não são detectáveis universalmente: manter botão/atalho manual.

Notificações precisam de política no processo principal, permissões de sessão e integração com a ponte existente. Para worker sem sanitização garantida, negar durante apresentação/proteção estrita. Alertas antigos na central do Windows podem permanecer: testar remoção quando a plataforma permitir e comunicar a limitação.

Validar também miniaturas Alt-Tab/barra de tarefas, popups e janelas auxiliares. No modo estrito, desabilitar as ações de copiar texto oculto oferecidas pelo próprio app; não apagar o clipboard do usuário automaticamente. Blur não bloqueia todas as formas de seleção/cópia da página remota. Medir separadamente a cobertura de tela, menus, notificações e acessibilidade.

**Limite do recurso:** blur é proteção visual contra observação casual, não criptografia, nem proteção contra malware, DevTools ou aplicações sob o mesmo usuário Windows. CSS não retira texto do DOM nem necessariamente da árvore de acessibilidade. Conteúdo sensível de leitores de tela exige modo específico e teste; não declarar “invisível para leitor de tela” sem validá-lo. O [safeStorage no Windows](https://www.electronjs.org/docs/latest/api/safe-storage) usa proteção vinculada ao usuário e não isola dados de todos os outros processos desse mesmo usuário.

Proteção de captura pode ser uma opção adicional, sujeita às limitações da plataforma; não é substituto da máscara. Ver [API de proteção de conteúdo](https://www.electronjs.org/docs/latest/api/browser-window). Não prometer impedir captura de toda origem.

### Matriz obrigatória de validação

| Cenário | Resultado esperado |
|---|---|
| Abrir/recarregar em discreto | Sem frame legível antes da máscara |
| Nova mensagem e lista virtualizada | Conteúdo novo nasce oculto |
| Foto, vídeo, figurinha, documento, áudio/transcrição | Todos respeitam categorias e apresentação |
| Busca, citações e modal de mídia | Sem texto fora da região protegida |
| Revelar e trocar de chat imediatamente | Revelação cancelada e sem herança |
| Alt-tab, minimizar, suspender, lock-screen | Reve­lações canceladas; retorno protegido |
| Conta A discreta, B normal | Preferências e PIN não vazam entre contas |
| Notificação de página e service worker | Genérica ou suprimida conforme política |
| Clique em notificação de conta bloqueada | PIN primeiro; privacidade continua ativa |
| WhatsApp muda seletores | Cobertura ampla e aviso, sem exposição automática |
| Teclado e leitor de tela | Controles acessíveis; limites documentados |
| Chamada em andamento | Proteção não encerra chamada nem hiberna a view |

## Plano faseado e critérios de saída

Estimativas de esforço de implementação por uma pessoa, sujeitas aos testes de integração; não são prazos garantidos. Cada fase tem entrega utilizável e pode ser interrompida sem comprometer o app ADR.

### Fase 0 — Preparar a separação (1–2 dias)

Registrar baseline, escolher conta/repositório pessoal, manter a origem identificável no histórico, criar repositório independente e desativar publicação herdada antes do primeiro push de tags. Definir código privado e política dos binários. Arquivar inventário de endpoints e dependências. Fazer triagem dos advisories, começando pelo runtime e pelas ferramentas expostas.

Antes de rodar qualquer protótipo, fixar `app.setName`, identidade de desenvolvimento e `userData` isolados, antes de criar sessões ou adquirir o lock de instância. Desabilitar updater herdado e apontar backups a diretório próprio. A fase 2 completa a identidade visual e do instalador; a separação dos dados não espera por ela.

**Saída:** novo destino e identidade definidos, CI sem acesso de escrita à ADR, baseline reproduzível e nenhuma atualização apontando à ADR. A conta pessoal/destino exatos ainda precisam ser informados antes de criar o remoto; o plano não depende disso.

### Fase 1 — Bira abre sem CRM (2–4 dias)

Remover gate de boot/navegação, listeners de cookies CRM, superfície CRM e botões dependentes. Criar início local simples e restaurar último serviço válido. Remover requests ADR e vendor empresarial após extrair ações necessárias. Remover integração comercial, tenant e logs de reunião CRM. Serviços continuam com login próprio.

Remover também preloads/handlers de tradução e Gmail que ficariam órfãos; ocultar um botão não elimina a dependência. Buscar domínios ADR e referências aos comandos em código, configuração, scripts, vendor e artefatos empacotados. Separar referências históricas de endpoints executáveis. Ações Google preservadas abrem formulários para revisão do usuário; não anunciar “Salvo” apenas porque o formulário abriu.

**Saída:** perfil novo e offline abrem o shell; WhatsApp e demais serviços acessíveis sem CRM; zero tráfego automático ADR; nenhuma identidade fictícia; testes existentes ajustados ao novo comportamento.

### Fase 2 — Identidade, dados e confiabilidade (2–4 dias)

Aplicar nome Bira Workflow, appId/AUMID próprios, userData e backup próprios, ícones provisórios e canal de atualização desativado/independente. Corrigir backup, Bitwarden e recuperação de histórico. Preservar validação IPC e cofres. Criar export/import de preferências com schema e backup antes de mudanças.

**Migração recomendada:** instalação nova e logins próprios. Importar somente preferências selecionadas, nunca cookies ADR, tokens CRM ou todo o perfil indiscriminadamente. Não prometer portabilidade de cookies e safeStorage entre apps/máquinas. Se a preservação de sessões for indispensável, tratá-la como experimento separado, com os apps fechados, cópia imutável e restauração ensaiada.

**Saída:** ADR e Bira coexistem, fechar/remover um não altera o outro; restauração testada em perfil de laboratório; falha de backup não fecha o app.

Importação de preferências deve validar tipo, versão, URLs, duplicidade de IDs e referências a contas, sem carregar credenciais, permissões herdadas ou destinos de atualização. Estado desconhecido/corrompido fica preservado para recuperação. Ensaiar falta de espaço, arquivo bloqueado e interrupção da gravação. Rollback restaura uma cópia compatível em pasta Bira; nunca abre perfil atualizado com binário antigo sem validação.

### Fase 3 — Privacidade WhatsApp (3–6 dias)

Implementar modos normal/discreto/apresentação, controles por conta, revelação temporária, proteção pré-exibição, cancelamento de estados e notificações. Manter PIN independente. Entregar fixtures e testes de transição, captura em laboratório e roteiro de conta real.

**Saída:** matriz acima aprovada, incluindo falha de seletores e workers. Nenhuma promessa de segurança depende exclusivamente de um filtro CSS. Este é o principal diferencial da primeira versão pessoal.

Ensaio de desempenho: comparar normal/discreto/apresentação na mesma máquina, com duas contas WhatsApp e cinco serviços, registrando CPU ociosa, RAM por processo, latência de troca de aba e rolagem. Observar crescimento após 50 trocas de conversa e 20 ciclos de hibernação/retomada. Desconectar observers/listeners ao destruir documentos e limitar timers de revelação. Definir orçamento após a linha de base; não prometer uma quantidade fixa de RAM para sites de terceiros.

### Fase 4 — Produtividade pessoal (2–4 dias)

Respostas rápidas locais, paleta de comandos, favoritos e presets de workspace. Painel “Hoje” compacto para tarefas/notas criadas deliberadamente. Converter conversa em tarefa por ação explícita; não varrer automaticamente todo o WhatsApp. Integração inicial com Bira Flow é convivência de atalhos e ditado normal no campo focado, sem nova ponte privilegiada.

**Saída:** respostas e tarefas funcionam offline; ações externas nunca enviam mensagens sozinhas; abrir conversa/tarefa respeita conta, PIN e privacidade.

### Fase 5 — IA própria e integrações opcionais (3–6 dias, fora do MVP)

Configurar um provedor por vez, chave no cofre do sistema e chamadas apenas pelo main. Traduzir texto selecionado e revisar rascunho primeiro. Definir limites de custo, timeout, cancelamento e quais dados sairão do computador. Uma alternativa local pode vir depois da medição de custo/qualidade.

Não classificar dependências como ausentes do produto apenas por estarem em `devDependencies`: o bundler inclui imports no executável. Conferir o bundle/SBOM. Para novos comandos, validar schema, origem, frame principal, conta de origem e limite de tamanho; páginas remotas não recebem chaves nem permissão genérica para executar comandos locais. A documentação atual do safeStorage já sinaliza evolução para API assíncrona; planejar a migração conforme o runtime escolhido, sem trocar criptografia junto com a marca às cegas.

Transcrição: começar com arquivo de áudio escolhido pelo usuário. Captura direta da mensagem do WhatsApp exige protótipo específico, pois hoje o app só envia um ID de mensagem que o CRM já conhece. Não armazenar todo o histórico para viabilizar isso. Cache por conta+conversa+mensagem+provedor, retenção limitada e limpeza explícita.

Lusha só volta com credencial pessoal e necessidade comprovada. Notas de reunião são manuais primeiro; não gravar/transcrever chamadas por padrão.

**Saída:** nenhuma dependência ADR; erro ou ausência de chave deixa o restante do app funcionando; conteúdo sensível não aparece em logs nem é enviado por efeito de abrir uma aba.

### Fase 6 — Empacotar e publicar (2–3 dias)

Finalizar marca em SVG/PNG/ICO, instalar ao lado da ADR, testar upgrade Bira→Bira e rollback de perfil com binário compatível. Manter release candidate e estável. Escolher assinatura Windows e estratégia DRM; EVS CastLabs não substitui Authenticode. Confirmar o helper Rust no pacote ou removê-lo conscientemente do escopo.

Código privado e instaladores públicos é uma opção simples, mas exige decisão do usuário sobre exposição dos binários. Para releases privados, começar com download manual autenticado; atualizar automaticamente exige desenho de credencial local, sem token embutido no instalador. O [electron-updater documenta suporte a repositório GitHub privado mediante token](https://www.electron.build/docs/features/auto-update/), que precisa ser tratado separadamente da autenticação do app.

**Saída:** instalação limpa, upgrade, desinstalação, notificações, chamada, PIN, blur, backup e restauração aprovados no Windows; release do Bira não depende de secrets ou infraestrutura ADR.

Bloqueadores de release: qualquer tráfego ADR não explicado, compartilhamento de userData com ADR, exposição visual em transição protegida, falha de restauração ou vulnerabilidade aplicável grave sem correção/mitigação documentada. Publicar o mesmo artefato que passou no teste; registrar hash, versão do runtime e resultado do smoke. Validar sessão expirada, falta de rede e retomada de atualização interrompida. Não confundir dependência indisponível com perfil corrompido.

**Ordem de entrega:** 0 → 1 → 2 → 3 → 6 forma o MVP pessoal (estimativa 10–19 dias de esforço). Fases 4 e 5 entram depois ou parcialmente conforme prioridade. Não atrasar privacidade para construir IA ou dashboard.

## Novas funcionalidades priorizadas

| Prioridade | Recurso | Benefício | Restrição de escopo |
|---|---|---|---|
| MVP | Atalho/botão “Ocultar tudo” | Privacidade imediata em reunião/ambiente compartilhado | Ação local, sempre acessível |
| MVP | Estado de proteção por conta | Saber o que está realmente coberto | Não confundir PIN com blur |
| Próxima | Paleta de comandos | Trocar conta, buscar favorito e ativar modo foco | Não pesquisar mensagens privadas por padrão |
| Próxima | Respostas rápidas locais | Reutilizar textos sem CRM | Inserir rascunho; nunca enviar automaticamente |
| Próxima | Conversa → tarefa com lembrete | Não perder retorno de atendimento | Captura escolhida, retenção e exclusão claras |
| Próxima | Presets “Trabalho / Pessoal / Apresentação” | Restaurar serviços e privacidade | Preservar sessões isoladas |
| Próxima | Tela de saúde de serviços | Explicar erro de rede, sessão, RAM ou adaptador quebrado | Diagnóstico mínimo, sem mensagens |
| Depois | Tradução e revisão com provedor pessoal | Substituir dependência ADR | Configuração opcional e ação explícita |
| Depois | Transcrição de áudio selecionado | Reaproveitar fluxo de voz Bira | Primeiro arquivo local, depois integração WhatsApp |
| Depois | Exportação cifrada de dados pessoais | Trocar de computador com previsibilidade | Não prometer exportar cookies portáveis |

Evitar neste ciclo: CRM próprio, campanhas automáticas, envio em massa, leitura permanente de conversas por IA, sistema multiusuário e mecanismo genérico de plugins.

## Marca proposta

Referência real: Bira Flow usa um monograma branco `b/∞` sobre fundo escuro e wordmark arredondado. A proposta mantém a família visual e adiciona direção ao fluxo na extremidade superior do símbolo. Nome de produto: **Bira Workflow**; wordmark: **bira workflow**.

Arquivo: `bira-workflow-conceito.png`. É uma prancha de conceito, não o conjunto final de produção. Foi gerada com a ferramenta nativa de imagens, usando `app.png` e `logo.png` do Bira Flow como referências. Aprovação visual deve preceder refinamento vetorial; o ícone precisa funcionar em 16/20/24/32/48/64/256 px e nos temas claro/escuro. A seta pode precisar de simplificação em tamanhos pequenos.

Não usar a prancha inteira como ícone. Entrega de produção futura: símbolo SVG, wordmark SVG, PNG transparente, ICO multirresolução, tray monocromático e variações para instalador. Manter Bira Flow e Bira Workflow distinguíveis na barra de tarefas.

Textos de interface devem explicar o estado: “Mensagens ocultas”, “Revelar por 5 segundos”, “Bloquear conta” e “Modo apresentação”. Não usar só mudança de cor ou um olho sem rótulo/tooltip. Manter foco visível, navegação por teclado e aviso de falha compreensível. Bira Flow continua sendo o ditado; Bira Workflow é o ambiente de trabalho. A proposta visual foi inspecionada em tamanho grande, mas ainda não foi homologada como ícone pequeno.

Prompt usado: “Use case: logo-brand. Create a polished brand proposal sheet for Bira Workflow, a personal desktop workspace app in the Bira Flow product family. Reference 1 is the existing app icon, reference 2 the existing wordmark. Preserve the recognizable bold rounded interwoven b/infinity mark and black/white character of Bira Flow. Make a modest distinctive workflow variation to the symbol, with continuous routed flow, visually close to the reference, no microphone imagery. Exact main text: 'bira workflow'. Clean bold rounded lower case typography, meticulous spacing. White artboard: primary horizontal logo black on white at top, large dark rounded-square app icon with white mark below left, smaller reversed white logo on charcoal below right. Only text is 'bira workflow', do not add explanatory labels, no decorative gradients, shadows, mockup objects or 3D. This is a concept proposal, flat graphic ready for later vector refinement.”

## Veredito

Base aproveitável, com testes e proteções relevantes. O caminho mais seguro é separar identidade/distribuição, remover dependências ADR de verdade e tornar privacidade visual uma capacidade independente. Não reescrever o aplicativo inteiro. Redução de linhas/dependências deve ser medida depois da extração do que será preservado; esta revisão não inventa uma economia numérica.

Referência adicional de segurança verificada: [advisory do Vitest](https://github.com/advisories/GHSA-5xrq-8626-4rwp). Alertas restantes estão na saída bruta e exigem triagem individual.

