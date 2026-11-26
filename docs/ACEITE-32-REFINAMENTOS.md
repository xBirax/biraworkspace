# Aceite do BiraWorkspace em 18 de novembro de 2026

O executável Windows, o Debian e o AppImage testados mostram **fb4619d706e56a84** no Sobre. O código do pacote corresponde à revisão local `9bfaab9ba3e3aacdd24fbbd96209e3b2ef1ac16b` na linha de desenvolvimento `codex/bira-review32`. O código e os testes foram preservados localmente. As conversas, modelos e perfis ficaram fora do Git.

## Windows

O teste no perfil real encontrou as contas **Pessoal** e **ADR** conectadas. O seletor mostrou **PT** nas duas conversas verificadas. Cada conta foi movida ao segundo workspace e devolvida. A sessão e a ordem lateral foram conferidas no retorno. Em Pessoal, uma medição do desfoque durante a troca de superfície não encontrou um elemento mascarado. Ao reabrir a lista e repetir a leitura, 130 elementos tinham o filtro de desfoque aplicado. Em ADR, a leitura confirmou o filtro na primeira tentativa. As preferências originais foram repostas. Os testes de envio usaram um destinatário simulado.

O aplicativo encerrou e reabriu pelo atalho **BiraWorkspace** do menu Iniciar. O atalho e a entrada de inicialização apontaram para o mesmo executável, com o ícone do Bira. O Windows permaneceu ligado durante o teste.

O roteiro principal concluiu build, typecheck, lint, **791 testes unitários** (631 do desktop e 160 dos pacotes), verificações Electron e backup. O ensaio de tradução passou com o preload de desenvolvimento e com o incluído no ASAR. Houve uma falha intermitente no teste de hover de uma janela fora da tela. A interação sintética passou a emular foco e a suíte da revisão empacotada passou.

## Medições no mesmo PC

Medianas de três execuções por versão, em processos novos, alternando as versões. O teste usou os motores do pacote anterior guardado em `release-destino` e da revisão final. O áudio sintético tinha 9,214 segundos. A frase de envio foi submetida enquanto cinco traduções de leitura estavam pendentes.

| Operação | Anterior | Atual |
|---|---:|---:|
| Tradução para envio com fila | 0,711 s | 0,600 s |
| Transcrição com o motor frio | 0,931 s | 0,917 s |
| Repetição do mesmo áudio com o motor carregado | 0,233 s | 0,223 s |
| Consultas da conversa parada em 60,3 s | 20 | 4 |
| Rolagem com inserção de 100 mensagens, tempo de quadro mediano | 16,6 ms | 16,6 ms |
| Rolagem, percentil 95 | 17,5 ms | 17,8 ms |

Os tempos de transcrição começam com o áudio disponível localmente em PCM. O tempo que o WhatsApp leva para disponibilizar a mídia varia por conversa e conexão. A mudança mais perceptível nesta amostra foi na fila de tradução. A rolagem manteve a mesma mediana.

## Cobertura dos 32 itens

| Itens | Implementação e resultado observado |
|---|---|
| 1–2 | Dois processos do Bira esperaram uma trava exclusiva em um perfil sintético. Uma única instância abriu o perfil após a liberação. Cópia e restauração passaram. Falhas de espaço e de manifesto foram injetadas e retornaram erro ao chamador. |
| 3–4 | O teste com esquema futuro preservou os arquivos principal e de recuperação. Na saída, um erro injetado em cookies permitiu concluir o armazenamento da mesma sessão e de outra partição. |
| 5–6 | Com a segunda conta já oculta, ocultar todas e restaurar reexibiu só a primeira. Com erro de disco, a cobertura permaneceu. Uma nova tentativa salvou a alteração. |
| 7–8 | Primeiro Enter durante a carga, repetição após erro, clique duplicado, edição manual, troca de conversa e desaparecimento do botão de envio após a colagem passaram em Electron. |
| 9–10 | Links mistos e mensagens só com endereços preservaram os caracteres, incluindo parâmetros, escapes, localhost, IPv6 e magnet. A mensagem composta de endereços dispensou o motor local. |
| 11–12 | O seletor abriu no rodapé estreito em bloco com campo multilinha. O teste geométrico confirmou que ficou na janela, junto ao campo e livre do botão de microfone. As consultas em repouso estão na tabela. O mesmo ensaio com uma resposta citada sintética também manteve o menu acessível. |
| 13–14 | A fila prioriza envio pendente e verifica a utilidade das leituras antes de processá-las. A ação explícita de enviar a menção original gerou uma mensagem sintética e preservou o idioma do contato. |
| 15–16 | Na conversa sintética, só o áudio visível entrou em processamento. Ocultar a conta durante um download simulado impediu a leitura dos bytes e a decodificação. O teste de conteúdo de reprodução única continuou passando. A biblioteca do WhatsApp pode concluir um download já requisitado. |
| 17–19 | O CLI e o motor residente foram exercitados com amostras PT, EN, ES e detecção automática. Houve imprecisão na amostra portuguesa. Em falha simulada de GPU, duas transcrições fizeram uma tentativa de GPU e duas execuções em CPU. A limpeza removeu o WAV abandonado, preservou o arquivo de outro nome e o WAV do processo ativo. |
| 20 | Em instalação isolada, uma interrupção preservou o ponteiro e os arquivos anteriores. A retomada preparou só o par pendente, publicou a geração validada e a próxima execução dispensou download. A validação de tradução brasileira passou com o motor do pacote. |
| 21–22 | Mutações passaram a atualizar as máscaras por trecho. Texto, foto, vídeo, áudio e elementos novos foram exercitados. O QR sintético ficou disponível em modo discreto e a máscara voltou com a lista. |
| 23–24 | Uma falha de disco no controle de transcrição restabeleceu o valor e identificou a conta. Uma falha de navegação após a gravação informou que o serviço tinha sido movido. A leitura do arquivo confirmou o workspace. A transferência preservou partição, cookie e rascunho em Electron. |
| 25–27 | Executável do menu e do login conciliados, identificação de compilação no pacote e no aplicativo, fluxo de envio incluído no roteiro de verificação e repetido contra o ASAR. |
| 28–29 | Build em checkouts limpos no Windows e Ubuntu. Nome, lançador e imagens de ícone do Linux foram ajustados. Bira e ADR 0.1.53 abriram lado a lado com diretórios de perfil e janelas diferentes. |
| 30–31 | O backend real do chaveiro em Ubuntu foi gnome_libsecret. Ao forçar basic_text, o aplicativo recusou ativar o PIN e orientou desbloquear o chaveiro. O backend indisponível e o chaveiro travado têm testes sintéticos. O backup do aplicativo apareceu indisponível no Ubuntu antes da confirmação. |
| 32 | Instalados o Debian e o AppImage da mesma revisão. Os dois abriram em X11 e Wayland com preferência sintética persistida. O Debian passou pela atualização de uma versão anterior numerada para o ensaio. Ambos reabriram após desligar e ligar a VM pelo mesmo disco. Os hashes foram conferidos novamente no Windows. |

## Pacotes Ubuntu 24.04 x64

Os arquivos de entrega estão em `apps/desktop/release-linux`. O teste usou Ubuntu 24.04.5 x86_64 em uma máquina virtual neste PC. A sessão GNOME com Ubuntu Dock reconheceu a janela do Bira como `biraworkspace.desktop`. O ADR antigo precisou de um perfil AppArmor específico na VM para poder abrir. O GNOME exibiu a janela dele separadamente com identificador genérico. Essa particularidade pertence ao pacote legado do ADR.

| Arquivo | SHA-256 |
|---|---|
| BiraWorkspace-0.2.0-local.1-amd64.deb | `9b3703b4462d4786b9cf07a3cf27422fa1cf75bb5b5bfbe4e301d2374c522412` |
| BiraWorkspace-0.2.0-local.1-x86_64.AppImage | `73c99c0648540b214d6ee7c039cb1a26210a8d3b8e09be965957d3ab4fae98c0` |

Para instalar o Debian, na pasta dos arquivos, execute `sudo apt install ./BiraWorkspace-0.2.0-local.1-amd64.deb`. Para integrar o AppImage ao menu do Ubuntu, deixe `bira-icon.png` e `integrar-appimage-ubuntu.sh` na mesma pasta e execute `sudo sh integrar-appimage-ubuntu.sh ./BiraWorkspace-0.2.0-local.1-x86_64.AppImage`. O integrador instala a imagem e seu perfil AppArmor em caminhos controlados pelo sistema.

As sessões reais do WhatsApp permaneceram no perfil Windows. Os ensaios de Linux usaram um perfil de teste. Backup e restauração pelo aplicativo no Linux continuam fora da primeira versão.
