# BiraWorkspace 0.2.0-local.3 no Ubuntu

Use o Ubuntu 24.04 LTS x86_64 com GNOME. Antes de formatar, copie a pasta completa de entrega para um disco externo que você conservará. As chaves das sessões Windows pertencem ao sistema de origem: num Linux novo, o primeiro login exige autenticar os serviços e ler os QR codes do WhatsApp.

## Instalar ou atualizar

Abra um terminal na pasta que contém os pacotes e confira o manifesto. Para instalar pelo menu de aplicativos do Ubuntu, use o Debian.

```sh
sha256sum -c SHA256SUMS
sudo apt install ./BiraWorkspace-0.2.0-local.3-amd64.deb
```

## Trazer as contas do ADR Workspace

Se o ADR Workspace já estiver instalado e conectado nesta conta do Ubuntu, **feche-o** antes de abrir o BiraWorkspace pela primeira vez. Na primeira abertura, o BiraWorkspace copia `~/.config/ADR Workspace` para `~/.config/BiraWorkspace`: sessões do WhatsApp (sem novo QR code), workspaces e serviços. Com o pacote `libsecret-tools` (instalado junto pelo `apt`), também copia a chave do chaveiro que abre os cookies, e os logins do Google e dos demais sites continuam. Sem ela, só esses sites pedem login de novo.

O perfil do ADR Workspace fica intacto. A cópia só acontece enquanto `~/.config/BiraWorkspace` não tiver estado salvo. Se o ADR Workspace estiver aberto, o BiraWorkspace avisa e fecha sem copiar. Depois de conferir as contas, remova o pacote antigo com `sudo apt remove adr-workspace` e, se quiser, apague a pasta `~/.config/ADR Workspace`.

Abra **BiraWorkspace** pelo menu. Em **Sobre**, confira a versão e o identificador registrados no relatório de aceite. Para atualizar o pacote, feche o aplicativo e repita a instalação com o novo arquivo.

Se preferir o AppImage, mantenha o ícone e o integrador ao lado do arquivo. O instalador integra a imagem ao menu e instala o perfil AppArmor específico no Ubuntu. Abra **BiraWorkspace (AppImage)** como seu usuário.

```sh
sudo apt install libfuse2t64
sudo sh integrar-appimage-ubuntu.sh ./BiraWorkspace-0.2.0-local.3-x86_64.AppImage
```

Os dois formatos usam o mesmo perfil BiraWorkspace do usuário. Escolha um para o uso cotidiano.

## Preparar a tradução e a transcrição

Com conexão à internet, instale as ferramentas do Ubuntu uma vez. Ainda na pasta da entrega, execute os dois preparadores como seu usuário. O segundo baixa o modelo multilíngue Whisper de aproximadamente 488 MB e compila o reconhecedor de CPU. A instalação verifica o SHA-256 dos modelos baixados. Se for interrompida, repita os comandos.

```sh
sudo apt install python3-venv curl cmake build-essential
python3 modelos/setup-translation.py
sh modelos/setup-voice-linux.sh
```

No Debian instalado, os mesmos scripts também ficam em `/opt/BiraWorkspace/resources/models/`. Os motores ficam em `${XDG_DATA_HOME:-$HOME/.local/share}/BiraWorkspace`. Após a preparação, tradução e transcrição processam o conteúdo localmente. Confira a prévia da tradução antes de enviar. A transcrição automática pode trocar palavras.

## Fazer e restaurar um backup

Em **Configurações → Geral**, clique em **Fazer backup agora**. Confirme o fechamento e aguarde a reabertura. A conclusão aparece no aplicativo e a cópia fica disponível em **Abrir pasta**. Para recuperar, selecione a data da cópia no painel, clique em **Restaurar cópia** e confirme. A recuperação verifica os hashes, troca o perfil por inteiro e guarda o perfil substituído em uma pasta `BiraWorkspace.anterior-…` ao lado do perfil ativo.

O backup cobre o perfil do aplicativo no mesmo usuário Ubuntu e depende do chaveiro original para abrir os dados cifrados. A pasta padrão de cópias é `~/.config/BiraWorkspace Backups`. Modelos de voz e tradução podem ser reinstalados. Formatar a unidade apaga os arquivos locais dessa unidade, inclusive as cópias e o chaveiro.

## Aceite no computador de uso diário

1. Conecte as duas contas WhatsApp pelos respectivos QR codes. Escreva um rascunho, mova cada serviço entre workspaces, feche e reabra. Confira a conta, o rascunho e a separação das conversas.
2. Ative PIN e desfoque, use **Ocultar agora** enquanto há áudio e volte às preferências anteriores. Repita depois de suspender e retomar o computador.
3. Faça uma chamada Meet com outra pessoa. Confirme com ela voz nos dois sentidos, câmera, janela e tela compartilhadas, recusa e encerramento da captura. Repita em GNOME Wayland e Ubuntu em Xorg, após reconectar o dispositivo e após suspensão.
4. Confira notificações, foco da conta correta, abertura de links e escolha de arquivos. Faça um backup e confira a data e o resultado no painel.

O relatório de revisão distingue as verificações da VM dos itens que dependem da sua máquina.
