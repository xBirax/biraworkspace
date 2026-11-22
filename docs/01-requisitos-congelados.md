# Refinamento 1 — Requisitos e orçamento congelados

> Status: **congelado para aprovação do gate**
>
> Origem: `PLANO_MESTRE_ADR_WORKSPACE.md` (22 de julho de 2026)
>
> Branch: `codex/1-congelar-requisitos`
>
> Custo recorrente incremental máximo: **R$ 0**

## Objetivo deste gate

Registrar P0, P1, fora de escopo e a restrição financeira antes de qualquer código de produto.
Nenhuma dependência paga nova é permitida na versão 1.

---

## P0 — Obrigatório para aprovar a versão 1

Itens sem os quais a release estável **não** pode ser aprovada.
Alinhados aos critérios de sucesso do plano mestre (§5).

| ID | Requisito | Critério de aceite |
|---|---|---|
| P0-01 | Múltiplos WhatsApps isolados | ≥2 contas autenticadas e isoladas após reinício; cookies/sessão de um workspace não vazam para outro |
| P0-02 | Cadastro sem limite artificial | ≥20 instâncias cadastradas; quantidade carregada limitada pela RAM (política §11) |
| P0-03 | Paridade CRM extensão 0.12.5 | Todas as funções identificadas na auditoria passam no teste de paridade |
| P0-04 | Segurança de tokens CRM | Nenhum token do CRM chega ao JavaScript da página do WhatsApp |
| P0-05 | Shell Electron segura | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` |
| P0-06 | Workspaces e recuperação | Criar/renomear/trocar workspaces; estado sobrevive a reinícios; soft delete recuperável 30 dias |
| P0-07 | Gmail e Calendar | Funcionam no `.deb` instalado **ou** entram em modo externo oficial (sem spoofing) |
| P0-08 | YouTube embutido | Reprodução no pacote instalado |
| P0-09 | Spotify | Reprodução estável no `.deb` via CastLabs gratuito **ou** fallback externo claro |
| P0-10 | ADR Browser | Abas, downloads/uploads, perfis, histórico/favoritos locais, abertura no Chrome/Brave/padrão |
| P0-11 | Empacotamento Ubuntu | `.deb` instala e inicia em Ubuntu 24.04 e 26.04 limpos; AppImage como alternativa |
| P0-12 | Custo zero incremental | Nenhuma nova assinatura paga; GitHub/Vercel/Neon existentes apenas |
| P0-13 | Qualidade de release | Smoke, visual, segurança e soak aprovados; beta → stable testado |
| P0-14 | Observabilidade local | Logs locais redigidos, rotacionados e exportáveis só por ação do usuário |

### Funções CRM P0 (paridade 0.12.5)

- Autenticação no ADR CRM por workspace
- `whoami` e impersonação autorizada
- Identidade da conversa (`getChatIdentity`)
- Lookup de contato
- Tradução
- Transcrição de áudio
- Respostas rápidas (inserir texto sem enviar)
- Cache de transcrições
- Configuração de `baseUrl`/tenant (produção fixa; localhost só em unpackaged)
- Painel/controles no WhatsApp com kill switch local
- Abrir CRM / abrir settings

---

## P1 — Desejável na v1, não bloqueia o gate mínimo

Podem entrar se não atrasarem os P0 nem introduzirem custo.

| ID | Item | Nota |
|---|---|---|
| P1-01 | Picture-in-picture no YouTube | Quando suportado pelo Chromium do Electron |
| P1-02 | Command palette (`Ctrl+K`) e atalhos completos | Incluídos no plano de UI; prioridade após shell estável |
| P1-03 | Tema claro / escuro / automático | Automático respeitando Ubuntu |
| P1-04 | Escala de interface 80%–200% | Acessibilidade |
| P1-05 | Badges de não lidos e bandeja do sistema | Incluído no escopo; pode estabilizar após multi-WhatsApp |
| P1-06 | Suspensão adaptativa de views inativas | Política §11; necessária para P0-02 sob carga, mas afinamento é P1 |
| P1-07 | SBOM + checksums SHA-256/SHA-512 | Obrigatório antes da stable; pode acompanhar o empacotamento |
| P1-08 | Navegação por teclado + contraste WCAG AA + Orca | Gate de acessibilidade antes da stable |
| P1-09 | Canal beta (prerelease) e stable | Fluxo GitHub Releases |
| P1-10 | AppImage com electron-updater | `.deb` permanece instalação explícita |

---

## Fora de escopo da versão 1

Não implementar, não prometer e não usar como desbloqueio de falha.

- Compatibilidade com extensões Chrome arbitrárias / Chrome Web Store
- Chrome Sync e gerenciador de senhas equivalente ao Chrome
- Brave Shields ou recursos próprios do Brave
- Fork do Chromium
- Windows, macOS e mobile
- Sincronização em nuvem das configurações do app
- Novo backend ou acesso direto do desktop ao Neon
- Disparos em massa / automações inexistentes na extensão
- Telemetria paga ou envio automático de dados (ex.: Sentry SaaS)
- Biblioteca de extensões com obrigação GPL ou licença comercial recorrente
- Atualização silenciosa de `.deb` com privilégios de root
- Spoofing de user-agent ou bypass de políticas Google/Spotify/Widevine
- Servidor próprio de updates
- Certificado pago de assinatura Linux na v1

---

## Orçamento congelado

| Item | Decisão |
|---|---|
| Custo recorrente incremental máximo | **R$ 0** |
| Electron / React / Vite / TypeScript | Permitido (gratuito) |
| CastLabs ECS/VMP | Somente camada gratuita |
| GitHub / Vercel / Neon | Somente planos já contratados |
| Sentry / telemetria SaaS | Proibido contratar |
| `electron-chrome-extensions` (GPL/comercial) | Proibido |
| Minutos extras de GitHub Actions | Não contratar automaticamente; preferir build local |
| Qualquer nova assinatura | Exige autorização humana explícita e reabre este gate |

Custos aceitos fora da meta de assinatura:

- Horas de desenvolvimento e manutenção
- Consumo eventual acima da franquia já contratada — **bloqueia o processo** até autorização

---

## Decisões de arquitetura já fechadas (não reabrir sem novo gate)

1. App desktop Electron/Chromium para Ubuntu, interface única ADR.
2. CRM nativo compartilhando código com a extensão; não carregar o ZIP no Electron.
3. Uma partição Chromium por sessão WhatsApp.
4. Gmail/Calendar/YouTube/Spotify/browser como serviços internos com fallback externo legítimo.
5. Chrome/Brave só como abertura externa.
6. `BaseWindow` + `WebContentsView` (sem `BrowserView`/`webview`).
7. pnpm workspaces; TypeScript strict; Zod; Vitest; Playwright; electron-builder.
8. Plano B: launcher de perfis Chrome gerenciados se o spike CRM desktop falhar em 5 dias úteis.

---

## Gates de interrupção (herdados)

Parar ou mudar de rota se:

- Spike CRM (`whoami` / `lookup` / `getChatIdentity`) falhar com segurança
- For necessário expor token ao renderer
- Dependência fundamental passar a exigir assinatura paga
- CastLabs gratuito indisponível → Spotify externo
- Google bloquear auth → Google externo
- Extensões arbitrárias virarem P0
- Fork do Chromium for exigido
- Violação de termos WhatsApp / automação de disparo
- `.deb` irreproduzível em Ubuntu limpo
- Custo exceder GitHub/Vercel/Neon sem autorização

---

## Checklist do gate (refinamento 1)

- [x] P0 listado com critério de aceite
- [x] P1 separado de P0
- [x] Fora de escopo explícito
- [x] Orçamento R$ 0 registrado
- [x] Nenhuma dependência paga nova autorizada
- [x] Decisões de arquitetura e Plano B referenciados
- [x] Gates de interrupção registrados
- [x] Aprovação humana deste documento (obrigatória para fechar o gate)

Aprovado por: Bira  
Data: 2026-07-22

## Veredito automático

`PASS 100%`: conteúdo do congelamento completo, alinhado ao plano mestre e aprovado.
