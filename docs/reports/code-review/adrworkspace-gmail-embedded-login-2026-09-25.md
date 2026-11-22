# Investigação do Gmail web no ADR Workspace

Data: 25/09/2026
Status: defeitos locais reproduzidos e corrigidos; causa do login no desktop ainda não isolada. Preparado para publicação no instalador `v0.1.38-rc.1`; consultar o release para confirmar disponibilidade.

## Evidência e correção da conclusão anterior

O print de `v0.1.37-rc.1` mostra um cartão produzido pelo ADR Workspace, não a página original do Google. Não temos a URL original, o erro original nem uma reprodução autenticada no Windows. Portanto, o print não prova que a causa específica seja a política de navegadores incorporados. A conclusão anterior de impossibilidade foi excessiva.

O requisito continua sendo Gmail web dentro do Workspace. A alternativa de interface própria via Gmail API foi recusada e não foi implementada.

## Achados confirmados no código

### P1 — Conteúdo legítimo pode ser substituído por cartão de erro

Local: `apps/desktop/src/main/workspace-window.ts`, handler `did-finish-load` anterior.

O app procurava frases de navegador inseguro em `document.body.innerText` em qualquer origem de Gmail, YouTube, Calendar, Drive e navegador. Um e-mail, documento ou resultado de busca citando "This browser or app may not be secure" satisfaz o predicado. A resposta assíncrona tampouco verificava se a navegação havia mudado. Ao detectar, `loadURL(data:...)` substituía todo o conteúdo. Isso interrompe uso legítimo e pode abandonar formulários em edição.

Reprodução local: o predicado original devolveu `true` para texto de um e-mail contendo essa frase. Não foi usado e-mail real. Removida a varredura e a substituição da página.

### P2 — Detecção por URL ignora origem e significado do parâmetro

Local: `apps/desktop/src/main/chrome-session.ts`, função anterior `isGoogleBlockedLoginUrl`.

Reproduções executando a função de HEAD; todas retornavam `true` incorretamente:

- `https://mail.google.com/mail/u/0/#search/browserorapp`
- `https://example.com/signin/rejected`
- `https://accounts.google.com/signin?continue=https://example.com/signin/rejected`

Nova função `isGoogleLoginRejectionUrl` aceita somente origem HTTPS exata de Accounts e rotas de rejeição conhecidas, incluindo prefixo `/v3/`. Uma rota de rejeição não determina sua causa. A função agora serve somente ao diagnóstico; não redireciona nem bloqueia páginas.

### P2 — Cartão oculta a evidência e ações do provedor

Local: `apps/desktop/src/main/workspace-window.ts`, antigos `GOOGLE_BLOCKED_HTML` e `showGoogleBlockedFallback`.

Removido o cartão, preservando a página original, seus detalhes e eventuais ações de recuperação. Navegações em subframes deixam de atualizar o estado principal em `did-navigate-in-page`. O novo evento de diagnóstico guarda apenas tipo de serviço e tipo de navegação, sem URL, query, fragmento, texto, credenciais ou cookies. A opção de abrir externamente continua no menu existente, por ação do usuário.

## Hipóteses ainda não confirmadas no desktop

- Restrição real do Google a navegador incorporado. É documentada, mas não foi isolada neste caso.
- Runtime antigo: pacote usa CastLabs Electron `35.7.5+wvcus`; Electron 35 está fora das linhas atualmente suportadas pelo upstream. Atualização requer validar CastLabs/Widevine, Windows, sessões e demais serviços; não garante login Google.
- Alterações preexistentes de identidade do navegador: o módulo reescreve User-Agent/client hints e injeta alterações em `navigator`. Há diferenças entre marcas declaradas no HTTP e em JavaScript. Isso é um fator de compatibilidade a investigar, não prova da causa. Esta rodada não amplia nem altera esses mecanismos.
- Bloqueador de recursos: a implementação não bloqueia mainFrame, mas pode filtrar subrecursos. Não há captura do desktop que mostre recurso de autenticação bloqueado. Não desativar globalmente com base no print.
- Pop-ups: `attachInAppNavigation` transforma novas janelas em navegação na mesma view. Pode afetar fluxos que dependem de opener; não temos evidência de que explique este login Gmail direto.

## Alternativas de arquitetura pesquisadas

A documentação do Google afirma que navegadores incorporados podem ser impedidos de entrar. A regra OAuth para aplicativos terceiros e o login direto no próprio Gmail são superfícies diferentes; citar apenas OAuth não diagnostica o login do site. A ajuda geral de Google Accounts é aplicável ao login web.

Trocar Electron por WebView2 isoladamente não é solução comprovada: a Microsoft documenta o bloqueio de autenticação Google também nesse componente. Um token obtido por OAuth externo não é uma sessão de Gmail web dentro de outra partição.

Há precedente concreto de produto para manter Gmail web numa interface com vários serviços: o Wavebox declara que saiu de Electron para um navegador Chromium próprio, e oferece múltiplas contas Gmail. Isso apoia estudar uma arquitetura de navegador; não garante aceitação pelo Google de um novo navegador ADR. Exigiria protótipo de autenticação real, manutenção do motor e plano de migração de dados. Não é simples troca de componente, e não deve migrar sessões existentes antes de validação.

Fontes primárias consultadas:

- [Google Accounts: navegadores compatíveis](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=en)
- [Políticas OAuth do Google](https://developers.google.com/identity/protocols/oauth2/policies)
- [Microsoft: diferenças entre Edge e WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features)
- [Wavebox: histórico Electron → Chromium](https://wavebox.io/about)
- [Wavebox: Gmail e instalação](https://wavebox.io/download?platform=windows)
- [Electron: calendário de suporte](https://releases.electronjs.org/schedule)

## Validação e próximo ponto de diagnóstico

- Predicados antigos: quatro falsos positivos reproduzidos localmente.
- 37 testes focados passaram: 16 novos casos de rejeição/origem/URL, 5 existentes de sessão e 16 de navegação.
- Build Desktop, compilação TypeScript e ESLint dos arquivos alterados passaram.
- Sem login real, smoke interativo Windows, atualização de runtime ou alteração de perfis/sessões nesta investigação. Publicação do instalador solicitada em seguida pelo usuário; pipeline Windows deve validar o pacote `v0.1.38-rc.1`.

Próximo passo para fechar a causa: gerar artefato de avaliação com esta correção, abrir Gmail no desktop afetado e observar a mensagem original. Não pedir senha nem exportação de cookies. Se houver rejeição explícita do navegador, avaliar runtime compatível e protótipo de navegador como frentes separadas, sem prometer que atualizar Electron remove a restrição.
