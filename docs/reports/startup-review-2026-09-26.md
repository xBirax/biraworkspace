# Revisão da abertura e dos fluxos críticos — 26/09/2026

Base: `v0.1.42-rc.1`. O usuário relatou uma exceção `assert(!this.paused)` em `node:internal/deps/undici` ao abrir o ADR Workspace no Windows. A captura não contém o URL da requisição, portanto a atribuição exata é uma inferência. A inspeção do processo principal encontrou uma única requisição Node `fetch` disparada automaticamente na abertura: a atualização das duas listas em `ad-blocker.ts`, quando o cache tem mais de 24 horas ou não existe. Ela também deixava o corpo de uma resposta HTTP não satisfatória sem leitura. Isso coincide com [o defeito documentado no Undici](https://github.com/nodejs/undici/issues/5360), que pode lançar uma exceção fora da promessa quando o socket fecha com o parser pausado.

## Achados e correções

| Gravidade | Achado e impacto | Correção |
| --- | --- | --- |
| P1 | `ad-blocker.ts`: `fetch` do Node em atualização automática de filtros; possível exceção no processo principal durante a abertura. | Usar `net.fetch` do Electron, que usa a rede do Chromium; cancelar o corpo de respostas de erro. Cache e domínios de reserva continuam disponíveis em falhas de rede. |
| P2 | `workspace-window.ts`: `window.open()` de um serviço podia passar URL `file:`, `data:` ou `javascript:` a `loadURL`, ou deixar `mailto:` na própria aba. | Aceitar apenas HTTP/HTTPS sem credenciais no popup; encaminhar `mailto:` ao sistema; ignorar esquemas inadequados. |
| P2 | `workspace-window.ts` e fixture visual: listeners de `console-message` ainda usavam os argumentos posicionais depreciados no Electron 44. | Ler `level`, `message`, `lineNumber` e `sourceId` do objeto do evento. |

## Superfícies percorridas

- Inicialização: backup prévio do perfil, instância única, janelas, sessões e atualização de filtros.
- Rede: chamadas `fetch` no processo principal, atualização automática, requisições CRM e Lusha acionadas pelo usuário.
- Sessões e dados: gravação atômica de estado, flush de cookies/DOM storage, partições Google/WhatsApp/CRM e backup de atualização.
- Navegação/IPC: guardas de remetente, permissões, links externos e popups.
- Downloads e cofre/PIN: política de nome/destino, criptografia do cofre e gravação do PIN.
- Atualizador e pipeline: tag, build Windows, migração sintética Electron 35→44 e publicação de candidato.

## Validação

- Build, typecheck e lint do monorepo concluídos.
- Suíte completa: 309 testes, incluindo os novos casos de rede e popup.
- Electron local com servidor HTTP sintético: resposta 503 de 128 KiB recebida e cancelada sem exceção.
- Painel de configurações: 72 combinações de tema, escala, aba e largura sem transbordamento nem erro de console.
- `pnpm audit --prod`: 0 avisos nos pacotes classificados como dependências de produção. Essa classificação não cobre todo o código empacotado, pois o processo principal inclui pacotes declarados em `devDependencies`. A auditoria do lockfile completo ainda aponta avisos, sobretudo em ferramentas de desenvolvimento e empacotamento; a análise de alcance e as atualizações devem ocorrer em uma rodada própria para não introduzir mudanças de empacotamento nesta correção de abertura.

O teste local não reproduz a configuração de rede do Windows do usuário. O pipeline Windows repete build, testes, rede sintética, painel e migração de sessões antes de publicar o instalador. Nenhum dado pessoal real é lido nos testes.
