# Medição de RAM e verificação do app

Execute na raiz do repositório, com Git Bash, depois de `corepack pnpm build`.
O app usa uma cópia de perfil temporário, CRM simulado em HTTPS local e janela fora
da tela, sem foco. A conta e o perfil do app instalado não são usados.

```bash
bash scripts/measure-ram/run.sh antes run
# Depois das alterações e de outro build:
bash scripts/measure-ram/run.sh depois run
bash scripts/measure-ram/run.sh depois verify
```

`run` leva cerca de 6 minutos. `verify` leva cerca de 2 minutos: prova o layout em
36 combinações, a destruição/recriação da barra auxiliar, a proteção de rascunho
editável por uma passada real de hibernação, o prazo por serviço e o foco do prompt.
O modo `ui` conserva o roteiro curto da lateral. Nenhum modo usa screenshots.
Para a prova de 375 px, `verify` reduz apenas na instância de teste o tamanho mínimo
da janela; o mínimo do produto continua em 640 px.

Requisitos: Electron já instalado no checkout, OpenSSL do Git Bash e porta 443
livre. Nunca use `pnpm install --offline`. Para um checkout sem dependências,
consulte `HANDOFF.md`.

`WORK` escolhe a pasta de resultados. O padrão é `../adr-measure`, ao lado do
repositório. Mantenha-a em D:. Use rótulos diferentes para preservar cada rodada;
repetir um rótulo substitui a cópia do build e o perfil daquela rodada.

Os resultados ficam em `result-<rótulo>-<modo>.json`; os logs, em
`run-<rótulo>-<modo>.log`. Falhas de asserção encerram o app com código 1.

Compare rodadas com a mesma pasta `WORK`: elas partem da mesma semente de perfil.
Não rode dois modos simultaneamente, porque ambos usam a porta 443.

## Como interpretar os números

- `workingSetMB`: soma da memória residente dos processos; inclui páginas
  compartilhadas e pode contá-las mais de uma vez.
- `privateMB`: o nome histórico do campo que soma `privateBytes` do Electron. No
  Windows, representa **commit privado**, não memória residente privada.
- Quantidade de processos, páginas e páginas do shell também importa. Serviços
  deslogados e CRM simulado não representam o consumo de contas reais.
- O modo `verify` testa conteúdo editável em uma página local, não prova o
  comportamento de todos os editores do Gmail, Notion ou Outlook.

## Memória residente privada no Windows

Com o app instalado aberto, execute em PowerShell:

```powershell
& .\scripts\measure-ram\windows-memory.ps1 |
  Set-Content -LiteralPath 'D:\Claude\adr-measure\instalado.json' -Encoding utf8
```

O script é somente leitura e informa working set, working set privado e commit
privado em MiB, por PID e no total. `-ImageName electron` mede instâncias locais de
Electron; feche outras instâncias de teste antes de comparar. Não associa PIDs a
abas: para medir especificamente o CRM real, é necessário o diagnóstico por view
ou acesso ao inspector da instância logada.

Esses números servem para avaliar a política. Trocar a métrica requer recalibrar
os limites; o script não altera a hibernação do app.
