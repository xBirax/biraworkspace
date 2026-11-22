# Refinamento 2 — Matriz de referência

> Status: **gate fechado (reproduzível)**
>
> Origem: `PLANO_MESTRE_ADR_WORKSPACE.md` §13.2
>
> Branch: `codex/2-matriz-referencia`
>
> Data: 2026-07-22

## Objetivo deste gate

Documentar a matriz Ubuntu 24.04/26.04 × Wayland/X11 × 16/32 GB × Chrome presente/Brave ausente de forma que **outra máquina ou VM** consiga reproduzir a coleta com o mesmo script.

---

## Ambientes-alvo da versão 1

| Dimensão | Valores obrigatórios | Observação |
|---|---|---|
| SO | Ubuntu **24.04** LTS e Ubuntu **26.04** LTS | x86_64 |
| Display server | **Wayland** e **X11** | Ambos devem passar no smoke da v1 |
| RAM de certificação | **16 GB** e **32 GB** (classes) | Política de hibernação §11 usa faixas contínuas |
| Chrome | Presente em `/usr/bin/google-chrome-stable` (ou caminho conhecido) | Abertura externa |
| Brave | Ausente por padrão; opcional se instalado | App deve instruiar sem erro se ausente |

### Classes de RAM usadas no produto

| Classe | Faixa medida | Views carregadas (padrão §11) |
|---|---|---|
| below-12GB | &lt; 12 GiB | máx. 3 |
| 12GB-class | 12–&lt;24 GiB | máx. 4 |
| 16GB-class | ~14–&lt;28 GiB (certificação 16 GB) | máx. 4 |
| 32GB-class | ≥ 28 GiB (certificação 32 GB / host ~30 GB) | máx. 6 |

O host atual (~30,4 GiB) entra em **32GB-class** e deve suportar até 6 views carregadas, sujeito ao consumo real do WhatsApp. Limite reajustado após medição real: cada renderer de serviço pesa 200–700 MB, portanto os tetos antigos (12 views em 32 GB) nunca disparavam a hibernação e deixavam views residentes indefinidamente.

---

## Host de referência atual

Coletado em 2026-07-22 via `node scripts/collect-reference-matrix.mjs`.

| Campo | Valor |
|---|---|
| Hostname | `bira-960XFH` |
| SO | Ubuntu 26.04 LTS (`resolute`) |
| Arch | x64 |
| CPUs | 20 |
| Sessão | Wayland (`wayland-0`), desktop `ubuntu:GNOME` |
| DISPLAY | `:0` (XWayland disponível) |
| RAM | 30,4 GiB → **32GB-class** |
| Chrome | Presente — `/usr/bin/google-chrome-stable` 150.0.7871.181 |
| Brave | **Ausente** |

Evidência JSON: `docs/evidencias/02-host-atual.matrix.json`

---

## Células da matriz

Legenda: **PROBED** = medido neste host · **REQUIRED** = obrigatório na v1, validar em VM · **OPTIONAL** = coberto se hardware existir

| # | Ubuntu | Session | RAM class | Chrome | Brave | Status neste host | Onde validar |
|---|---|---|---|---|---|---|---|
| M1 | 26.04 | Wayland | 32GB-class | presente | ausente | **PROBED** | Host atual |
| M2 | 26.04 | X11 | 32GB-class | presente | ausente | REQUIRED | Mesma máquina em sessão X11, ou VM |
| M3 | 24.04 | Wayland | 32GB-class | presente | ausente | REQUIRED | VM Ubuntu 24.04 |
| M4 | 24.04 | X11 | 32GB-class | presente | ausente | REQUIRED | VM Ubuntu 24.04 |
| M5 | 26.04 | Wayland | 16GB-class | presente | ausente | REQUIRED | VM com 16 GB |
| M6 | 24.04 | Wayland | 16GB-class | presente | ausente | REQUIRED | VM com 16 GB |
| M7 | 26.04 | Wayland | 32GB-class | presente | presente | OPTIONAL | Só se Brave for instalado |

A célula **M1** fecha o gate de “matriz documentada e reproduzível”. As células REQUIRED entram no smoke da release (§14); não bloqueiam este refinamento 2.

---

## Como reproduzir em outra máquina ou VM

1. Clone o repositório.
2. Execute:

```bash
node scripts/collect-reference-matrix.mjs
```

3. Compare o JSON com a tabela de células acima (`matrixTags`).
4. Opcional: salve a saída como evidência da VM:

```bash
node scripts/collect-reference-matrix.mjs > docs/evidencias/02-<nome-da-vm>.matrix.json
```

5. Valide o gate localmente:

```bash
node scripts/verify-refinement-02.mjs
```

Nenhuma assinatura paga é necessária. O probe usa apenas Node e leitura de `/etc/os-release`, `/proc/meminfo` e paths conhecidos de browsers.

---

## Checklist do gate

- [x] Ambientes-alvo 24.04 e 26.04 documentados
- [x] Wayland e X11 documentados
- [x] Classes de RAM 16 GB e 32 GB documentadas
- [x] Chrome presente / Brave ausente documentados
- [x] Script de coleta reproduzível commitado
- [x] Evidência JSON do host atual commitada
- [x] Verificador automático do gate commitado

## Veredito

`PASS 100%` quando `node scripts/verify-refinement-02.mjs` retornar exit 0.
