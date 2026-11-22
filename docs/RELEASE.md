# Release

## Windows (é o que o usuário instala)

```bash
corepack pnpm --filter @adr/desktop run pack:win
```

Sai em `apps/desktop/release/`:

- `ADR-Workspace-Setup-<versão>.exe`
- `ADR-Workspace-Setup-<versão>.exe.blockmap`
- `latest.yml` — **sem este arquivo o update dentro do app não enxerga a versão**

### Assinatura VMP (obrigatória)

`scripts/vmp-sign.cjs` roda no `afterSign` e chama
`python -m castlabs_evs.vmp sign-pkg`. O binário da CastLabs vem assinado de
fábrica, mas o electron-builder renomeia `electron.exe` → `adr-workspace.exe` e a
assinatura para de casar — sem re-assinar, o CDM do Widevine carrega e o servidor
de licença recusa mesmo assim (sintoma: "toca no Chrome, não toca aqui").

Se falhar, o build QUEBRA de propósito. Reautentique:

```bash
python -m castlabs_evs.account reauth
```

`ADR_SKIP_VMP=1` pula a assinatura — só para teste local, nunca para release.

## Atualizar a própria máquina (sem instalador, sem certificado)

```bash
corepack pnpm update:local
```

Empacota com `--dir` e copia `release/win-unpacked` por cima de
`%LOCALAPPDATA%\Programs\adr-workspace`. É o caminho recomendado enquanto não
houver certificado Authenticode, porque contorna o Smart App Control pela raiz:
**o bloqueio é do instalador, não do executável do app** — o `adr-workspace.exe`
nunca foi assinado e sempre rodou.

Preserva o que importa:

- a assinatura VMP vai junto (`adr-workspace.exe.sig`), então **o Spotify toca** —
  em `pnpm dev` não há VMP e ele leva 403;
- `app.isPackaged` continua `true`, então o userData segue `ADR Workspace` e não
  `ADR Workspace Dev`: **os logins ficam onde estão**;
- o desinstalador do NSIS não é apagado (copia por cima, sem espelhar).

O app é fechado por WM_CLOSE, não por kill — fechar pelo caminho normal passa
pelo `before-quit` e grava os cookies. O script recusa rodar se o build estiver
sem VMP.

`--dir` ainda pula o NSIS, que é justamente onde o build falha com `spawn UNKNOWN`.

## Instalar por cima com backup do perfil

```powershell
powershell -ExecutionPolicy Bypass -File scripts\instalar-com-backup.ps1 -Installer <ADR-Workspace-Setup-X.exe>
```

Para quem testa um instalador fora do atualizador. O script fecha o app por
WM_CLOSE (o `before-quit` grava os cookies; matar o processo perde login), recusa
seguir se ele não fechar, copia `%APPDATA%\ADR Workspace` com o app FECHADO para
`%LOCALAPPDATA%\ADR Workspace Backups\antes-<versão>-<data>` (sem caches regeneráveis)
e só então roda o instalador e espera. Cópia falhou: nada é instalado.

Restaurar: com o app fechado, copiar a pasta `profile` do backup por cima de
`%APPDATA%\ADR Workspace`.

**Downgrade:** desde a 0.1.50 um tipo de serviço desconhecido fica estacionado
(`parkedServices`) em vez de invalidar o estado. Builds até a 0.1.49 não fazem
isso: abrir a 0.1.49 depois de a 0.1.50 gravar um TikTok põe o estado em
quarentena (`state.v1.json.corrupt-*`) e recomeça do zero. Voltar versão = restaurar
o backup do perfil.

## Smoke depois de instalar: conte JANELAS, não processos

```powershell
(Get-Process adr-workspace | Where-Object { $_.MainWindowHandle -ne 0 }).Count
```

Tem de ser `1`. Processo vivo não prova nada: uma exceção no meio de
`createWorkspaceWindow` deixa as `WebContentsView` já criadas de pé — oito
processos, zero janelas, nenhum erro na tela. Foi assim que um `ReferenceError`
por zona morta temporal passou batido por um "smoke" que só contava processos.

`corepack pnpm test` também não pega isso: o erro só existe com a janela real
sendo montada.

## Smart App Control bloqueia o build (e o update)

Sintoma no build: `⨯ spawn UNKNOWN` em `NsisTarget.computeScriptAndSignUninstaller`.
Sintoma na máquina do usuário: notificação "Parte deste aplicativo foi bloqueado —
não é possível confirmar quem publicou ADR-Workspace-Setup-X.Y.Z.exe".

É a mesma causa nos dois: o instalador **não é assinado com Authenticode**, e o
Smart App Control do Windows 11 recusa executável sem editor verificável. No build,
quem tenta executá-lo é o Node do electron-builder (ele roda o instalador temporário
para gerar o desinstalador). Na atualização, é o próprio app, via electron-updater.

Conferir o estado:

```powershell
(Get-MpComputerStatus).SmartAppControlState
```

Repetir o build costuma passar (a decisão do Smart App Control é por reputação e
não é determinística) — mas isso é sorte, não solução.

**A solução é assinar com Authenticode.** Um certificado OV/EV resolve os dois
sintomas de uma vez, e ainda destrava a verificação de assinatura do
electron-updater e a instalação automática (ver seção de atualização abaixo).

Desligar o Smart App Control também resolve, mas é decisão de quem usa a máquina e
é **irreversível**: uma vez desligado, só volta a ligar reinstalando o Windows.

## Publicar

O app instalado busca em `ADRAGENCIACRM/adrworkspace-releases`, provider `github`,
`releaseType: release` — **prerelease não é oferecida**. Confira em
`resources/app-update.yml` do app instalado.

O workflow `.github/workflows/release-windows.yml` gera o instalador ao receber
uma tag `v<versão>`. Uma tag `-rc.N` publica uma pré-release automaticamente;
uma tag estável só publica após `workflow_dispatch` com smoke de Windows
confirmado e evidência registrada. O dispatch **não recompila**: o job `promote`
baixa o artefato do push bem-sucedido da mesma tag e commit (o build que passou
pelo smoke) e publica esse. Se a tag foi movida ou o artefato expirou, ele falha
sem publicar — gere uma tag nova. A tag `-rc.N` empacota a versão `x.y.z-rc.N`,
então quem testou a candidata recebe a estável `x.y.z` pelo atualizador.

Os secrets ficam restritos aos passos que os usam: `ADR_RELEASES_TOKEN` só nos
`gh release create`, e a credencial EVS só é escrita em disco logo antes do
electron-builder (depois de install, build e testes) e apagada em seguida.
Ele exige dois secrets no repositório privado:

- `EVS_CONFIG_B64`: conteúdo base64 de `~/.config/evs/config.json`, usado apenas
  pelo runner efêmero para autenticar a assinatura VMP;
- `ADR_RELEASES_TOKEN`: token com permissão para criar releases no repositório
  `ADRAGENCIACRM/adrworkspace-releases`.

Antes da tag, confirme que `apps/desktop/package.json` contém a mesma versão e
que o commit correspondente já está em `origin/main`. A tag deve apontar para
esse commit; apenas alterar o `package.json` não publica uma atualização.

```bash
git tag -a v<versão> -m "ADR Workspace <versão>"
git push origin v<versão>
```

O job valida a correspondência entre tag e pacote, instala o cliente EVS,
confirma a autenticação, executa build/typecheck/test, gera o instalador com VMP
e publica `.exe`, `.blockmap` e `latest.yml` no repositório de releases.

O comando manual abaixo é somente recuperação caso o GitHub Actions esteja
indisponível e os artefatos já tenham sido gerados e verificados localmente. Ele
não substitui o smoke obrigatório para uma release estável.

```bash
gh release create v<versão> \
  apps/desktop/release/ADR-Workspace-Setup-<versão>.exe \
  apps/desktop/release/ADR-Workspace-Setup-<versão>.exe.blockmap \
  apps/desktop/release/latest.yml \
  --repo ADRAGENCIACRM/adrworkspace-releases \
  --title "v<versão>" --notes "..."
```

A tag da release tem de bater com a `version` de `apps/desktop/package.json`.

## Atualizar por dentro do app

Configurações → Sobre → **Buscar atualizações** → **Instalar**.

O download e a instalação são automáticos. Após conferir o SHA-512 do pacote,
o app grava estado e sessões, encerra e relança com a nova versão. O Windows
pode abrir confirmação própria do instalador.

O pacote ainda não tem Authenticode (`build.win` não tem `certificateFile`/
`publisherName`), então esta política confia no HTTPS do GitHub e no SHA-512
publicado. Certificado Authenticode continua necessário para verificação de
editor pelo Windows.

A checagem periódica roda a cada 4 h (12 s após abrir).

### Versão 0.1.50 — TikTok, Google Meet e login Google do workspace

TikTok e Google Meet no catálogo; "Continuar com o Google" dos serviços com login
próprio usa as contas Google já logadas no workspace (escolha pelo e-mail);
lembrete de reunião pelo iCal secreto, mini-janela da chamada, atalho do
microfone e registro da reunião no CRM; backup do perfil pelo instalador
(`build/installer.nsh` + `backup-profile.ps1`) e pelas Configurações;
permissões lembradas revisáveis. Notas: `docs/release-notes-0.1.50.md`.

Candidatas rc.1–rc.6 testadas por instalador local, por cima do perfil real
(com backup). O `package.json` volta à versão base `0.1.50` para a tag: o
workflow recusa tag cuja base não bate com ele. Antes da tag, rodar localmente os
verificadores do workflow (`scripts/verify-*.cjs`): o de Configurações pegou um
transbordo na aba Notificações que o `pnpm test` não vê.

### Versão 0.1.47 — IA, limpar notificações e Spotify

Claude e Gemini no catálogo, login social em janela própria, "Limpar
notificações" por serviço, Spotify tocando de novo (player desktop), PIN do
WhatsApp por sessão com limite persistente e extensão CRM 0.15.5. Notas:
`docs/release-notes-0.1.47.md`. A rc.5 foi instalada por cima do perfil real
no Windows em 06/10/2026, com backup do perfil antes; a estável difere dela só
na documentação.

Desde esta versão a tag `-rc.N` empacota `x.y.z-rc.N` e a estável é publicada
pelo job `promote` (despacho manual), que não recompila.

### Candidata 0.1.46-rc.1 — painel Gmail e ChatGPT

O Gmail embutido passa a carregar apenas o painel ADR CRM, sem o tradutor
genérico que podia cobrir seu botão. O painel agora reconhece respostas inline
e registra `gmail-panel` no diagnóstico quando montar ou falhar. ChatGPT entra
no catálogo com sessão persistente separada por conta. A candidata depende de
smoke real em Windows, especialmente visibilidade do botão, login ChatGPT e
persistência das sessões. Notas: `docs/release-notes-0.1.46-rc.1.md`.

O build da tag `v0.1.46-rc.1` parou antes do empacotamento: o
`EVS_CONFIG_B64` ainda estava presente, mas a renovação gratuita do EVS
solicitou novamente a senha (`NonInteractiveError`). O workflow agora tenta
primeiro `refresh` com esse arquivo, como nas versões anteriores. Se a renovação
não funcionar, é necessário reautenticar a **conta EVS** e atualizar o
`EVS_CONFIG_B64`, ou configurar ambos `EVS_ACCOUNT_NAME` e `EVS_PASSWD` nos
secrets do repositório. Login no portal `account.castlabs.com` não renova os
tokens do cliente EVS. Não coloque credenciais no código nem nos logs.

Depois de renovar, criar tag candidata `v0.1.46-rc.2` a partir da `main`;
reexecutar `rc.1` usaria o workflow antigo gravado naquela tag. O instalador
segue indisponível até o pipeline passar. EVS é gratuito; autenticação e
assinatura VMP continuam obrigatórias.

### Candidata 0.1.45-rc.1 — Trello e clareza nas atualizações

O Trello web entra no catálogo com sessão isolada por conta. A tela de
Atualização e suporte passa a dizer quando não há versão **estável** mais nova
e oferece acesso às candidatas para download manual. O botão da versão 0.1.43
continua sem ler pré-releases: esse comportamento já está instalado no desktop
e só muda depois que um novo instalador for aplicado. Notas:
`docs/release-notes-0.1.45-rc.1.md`.

A candidata não é promovida automaticamente a estável. A publicação estável
exige o smoke de `docs/windows-release-smoke.md`, inclusive sessões existentes
e login Trello após reiniciar. O workflow pede `windows_smoke_confirmed` e
`smoke_evidence`; não marcar esses campos sem resultado real em Windows.

### Candidata 0.1.44-rc.1 — Gmail e diagnóstico

O painel ADR CRM no Gmail embutido prepara prévias manuais em inglês/espanhol,
consulta contatos e mostra apenas negócios cujo contato é principal. A rota
`/api/gmail/assistant` do CRM deve estar publicada antes do instalador.
O diagnóstico de RAM deixa explícito o momento da medição; a restauração da
Central bloqueia operações duplicadas. Notas:
`docs/release-notes-0.1.44-rc.1.md`.

Publicar a candidata pela tag `v0.1.44-rc.1` gera um instalador para download
manual. Ela não aparece em **Verificar atualizações** porque o provider está
configurado para releases estáveis. A versão `v0.1.44` só deve ser publicada
após `docs/windows-release-smoke.md` com evidência da instalação/atualização e
persistência das sessões.

### Candidata 0.1.43-rc.2 — Central de Desempenho

Configurações → Desempenho oferece análise local de 15 segundos, recomendações
com prévia, histórico e restauração dos ajustes suportados. O executor antigo
`system-boost` que elevava PowerShell foi retirado. A limpeza de Temp requer
prévia e confirmação específica de exclusão definitiva; ainda precisa de smoke
em Windows isolado. A restauração automática do backup legado está desabilitada.
A fase administrativa exige Authenticode e terá publicação separada.

Não publicar `v0.1.43` estável sem cumprir os gates de Windows, sessões e
recuperação de `docs/reports/performance-center-2026-09-26.md`. A RC permanece
download manual. Notas: `docs/release-notes-0.1.43-rc.2.md`.

### Versão 0.1.37

A navegação reúne os workspaces e serviços com nomes opcionais, status visual
de carregamento/falha/hibernação, contagens de não lidas por serviço e workspace,
e expansão recolhível persistida. Reordenação pode ser feita por arraste ou por
`Alt+Shift+seta`; foco e nomes acessíveis acompanham o estado. Escala de 80% a
200% também ajusta a barra. Configurações abrem na tarefa correspondente e
resultados de sucesso/erro usam a mesma região acessível de status.

O redesenho mantém o estado das contas e serviços existente. Smoke completo de
serviços, login persistente, temas, escalas e regressão Linux ainda é necessário
antes da publicação estável.

### Versão 0.1.36

Tradutor disponível em Gmail, Instagram e demais guias compatíveis. O card Lusha
agora prepara negócio no CRM com intenção temporária, deduplicação de pessoa/empresa
e reaproveitamento de dados revelados sem expor PII na URL.

Falha ao salvar estado/sessões não reinicia automaticamente a tentativa de
instalação. A preparação tem limite de 10 segundos; em caso de erro, o botão de
instalação permanece disponível para uma nova tentativa explícita. Resolver um
flush antigo depois desse limite não dispara o instalador.

Ícone do aplicativo incluído em ICO multirresolução para executável e atalhos do
Windows; a janela usa o wordmark ADR incluído no pacote. O indicador de não lidas
usa overlay da barra de tarefas no Windows e mantém `app.setBadgeCount` em Linux e
macOS. A checagem do contador cobre 0 e valores até `99+`. A pipeline aceita tags
`-rc.N` como pré-release para avaliação e não as publica como versão estável.

Validação visual final de instalação limpa, upgrade sobre 0.1.35, atalhos fixados,
Start e overlay ainda exige smoke em Windows antes da tag estável.

### Versão 0.1.35

Hibernação de RAM: o CRM não nasce no boot se a sessão já estiver autenticada;
depois do login humano a view fecha na hora. O LRU conta o CRM no teto de views.
Pin de YouTube/Spotify cede em pressão high/critical sem áudio. Probe de
formulário só olha o campo focado. `closeAllConnections` no hibernate; debugger
CDP solta depois de injetar o stealth. Gate do login: cookie `changed` + 15 s.
Toast de changelog no boot saiu. `ViewManager` morto.

### Versão 0.1.29

A tentativa 0.1.28 parou antes de gerar/publicar o instalador: o teste do
workflow não aceitava checkout CRLF no runner Windows. A 0.1.29 corrige essa
asserção e a exercita com LF e CRLF; a tag anterior fica preservada para auditoria.
Também explicita `--publish never` no empacotamento Linux: tags não devem fazer
esse job tentar publicar, pois ele apenas gera artifacts de CI.

Inclui as sete correções do code review de 13/09/2026: isolamento do cache e do
workspace nas views recuperadas, expiração do PIN por atividade real, retry
controlado do atualizador, preservação do backup válido, restauração da navegação
após hibernação e gatilho de empacotamento Linux. O navegador externo continua
selecionável pelo usuário; preferências existentes são preservadas e novas
instalações usam o padrão do sistema.

### Versão 0.1.18

Inclui aviso interno no toast e no sino informando a atualização do menu CRM do
WhatsApp, que agora permite desligar autoenvio na conversa atual. A lógica fica
na extensão vendorizada `0.15.1`; publicar o CRX exige a chave privada da
extensão e deploy atômico de `update_manifest.xml`.

## Linux

```bash
corepack pnpm --filter @adr/desktop run pack:linux
corepack pnpm release:artifacts
```

Gera `.deb`, `.AppImage`, `SHA256SUMS` e `sbom.cdx.json`. Não tem VMP (não se
aplica) e não sobe sozinho.

## CI

`.github/workflows/ci.yml`: PR/push de branches configuradas e tags `v*` rodam
install, build, typecheck e test. Em tag, o job Linux faz seu próprio build e
verifica o runtime Electron no checkout limpo antes de empacotar e subir artifacts
— sem criar release. A publicação Windows continua no workflow separado.

## Ainda precisa de humano

- Certificado Authenticode (destrava a instalação automática)
- Smoke em Ubuntu limpo
- Logins WhatsApp/Google/CastLabs
- Aprovação de piloto interno

## Smoke de privacidade

Antes de release estável, validar em perfil limpo:

1. Ativar bloqueio em Configurações → Privacidade e confirmar PIN de 4 a 12 dígitos.
2. Abrir WhatsApp, informar PIN errado cinco vezes e confirmar espera de 30 segundos.
   Errar mais cinco depois da espera e confirmar 1 minuto (a espera dobra a cada bloqueio).
3. Com a espera ativa, encerrar e reabrir o app: a espera continua (não zera no reinício).
4. Em Privacidade → Desativar, errar o PIN cinco vezes: o mesmo limite vale ali.
5. Informar PIN correto e confirmar abertura do WhatsApp.
6. Encerrar e reabrir app; confirmar que WhatsApp pede PIN novamente.
7. Remover ou corromper `vault/whatsapp-lock.<id>.v1.json`, abrir Privacidade e confirmar recuperação somente após confirmação explícita; as outras sessões continuam pedindo PIN.
8. Confirmar que `state.v1.json` não contém PIN e que sessões continuam intactas.
