# Plano para a primeira versão Linux do BiraWorkspace

Proponho começar no Ubuntu 24.04 LTS x86_64 com GNOME. Entregar primeiro um pacote `.deb` instalável e depois um `.AppImage` da mesma revisão. Esse é o alvo inicial de homologação. Outras distribuições, KDE e ARM64 exigem testes próprios.

O repositório já tem os comandos `pack:deb`, `pack:appimage` e `pack:linux`. O pacote Linux ainda usa o nome ADR no arquivo, no lançador e nos metadados de manutenção. A configuração usa os ícones de `build/icons`, o Electron disponível em `node_modules/electron/dist` e um fluxo de integração desativado. A suíte do Windows fornece uma base de regressão. A aprovação da versão Linux depende dos testes abaixo.

| Etapa | Trabalho | Critério para avançar |
|---|---|---|
| 1. Identidade e perfil | Em um checkout Linux limpo, ajustar nome do pacote, lançador, ícones em todos os tamanhos, identificação da janela e mantenedor. Usar perfil Bira próprio e verificar o caminho com e sem `XDG_CONFIG_HOME`. | Bira e ADR podem coexistir. Abrir pelo menu, fixar no dock, receber uma notificação e reabrir pelo ícone identifica o mesmo BiraWorkspace. |
| 2. Build reproduzível | Usar Node 22, pnpm 9.15.9, o lockfile e o binário **Linux x64** da versão CastLabs fixada. Verificar o checksum e a arquitetura ELF. Executar build, checagem de tipos, lint e testes em Linux. Adaptar os testes que hoje pressupõem PowerShell ou caminhos Windows. | O checkout limpo produz os dois artefatos e seus SHA-256. Registrar versão do sistema e dependências instaladas. Inspecionar metadados, permissões, executável e arquivo desktop antes de instalar. |
| 3. Integrações do sistema | Testar PIN/cofre com GNOME Keyring desbloqueado, bloqueado e ausente. Tratar explicitamente o backend `basic_text`. Adaptar o backup PowerShell com encerramento, cópia e restauração testados em Linux ou indicar a indisponibilidade desse recurso na interface da primeira versão. Validar navegador externo, seletor de arquivos, notificações e atalhos. | Uma falha do chaveiro aparece na interface. A aplicação preserva os dados existentes. O backup só informa sucesso após confirmar que pode recuperar os dados de teste. |
| 4. Uso real em dois workspaces | Conectar cada WhatsApp pelo QR do próprio serviço no Linux. Os perfis do Windows usam chaves do sistema. Testar reinício e suspensão, transferência das duas contas entre workspaces, rascunho, PIN, desfoque de texto/fotos/vídeos/áudios, revelação por mouse/Alt e **Ocultar agora**. | As duas contas reabrem conectadas e independentes. Mover uma conta preserva a conversa, o rascunho e as configurações. A ocultação cobre ambas, silencia o áudio e permite voltar. |
| 5. Desktop e instalação | Em uma VM Ubuntu limpa, instalar o `.deb`, atualizar sobre a versão de teste, remover o pacote e conferir a preservação do perfil. Abrir o AppImage como usuário comum e documentar a dependência de FUSE caso necessária. Testar Wayland e X11, dock, áudio, microfone, câmera e compartilhamento via portal/PipeWire. Usar sandbox habilitado. | Há resultados por formato e sessão gráfica. O teste com interface confirma ícone, mídia, permissões e comportamento das janelas. Registrar à parte o resultado do Spotify/DRM caso entre no escopo. |
| 6. Entrega | Reunir os pacotes, hashes, instruções de instalação/atualização e resultados por recurso. Revisar os alertas de dependências já registrados antes de distribuir. | Um segundo ambiente limpo instala e abre o mesmo artefato. A matriz distingue o que passou, o que falhou e o que fica indisponível na primeira versão. |

## Primeira execução de engenharia

Na máquina ou VM Linux, a partir da raiz do projeto e após os ajustes de identidade, executar:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm ensure:electron
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm --filter @adr/desktop exec electron-builder --linux deb AppImage --x64 --publish never
```

Guardar os resultados de instalação, dock e chamadas em uma sessão gráfica Linux. Uma execução automatizada em display virtual pode cobrir navegação e preferências. O aceite de áudio, vídeo e compartilhamento exige também dispositivos disponíveis e uma sessão gráfica funcional.

A diferença entre o chaveiro Linux e a proteção de dados do Windows está documentada pelo Electron. [Documentação do safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). Os formatos de distribuição e a integração do arquivo desktop são configurados no empacotador. [Configuração Linux do electron-builder](https://www.electron.build/linux/).
