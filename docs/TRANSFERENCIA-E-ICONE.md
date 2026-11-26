# Transferência de serviços e ícone — 17/11/2026

## Transferir um serviço

Clique com o botão direito no serviço e escolha **Mover para workspace → destino**. Também é possível arrastar o serviço para o botão ou o nome do workspace de destino na barra lateral. Serviços em um grupo inativo também podem ser arrastados ou abertos pelo menu.

A transferência mantém o ID do serviço, perfil, partição, cookies, PIN, preferências de privacidade e página aberta. Não duplica a conta nem apaga os dados do workspace anterior. Serviços importados do ADR usam o mesmo caminho dos demais. A janela passa para o destino; é possível mover o serviço de volta.

## Ícone

O ícone padrão do Electron estava embutido no executável local porque a edição automática de recursos do empacotador havia sido desabilitada. O empacotamento agora aplica diretamente o ícone **b** do BiraWorkspace e os campos de identificação do produto. O ícone foi extraído do executável gerado e inspecionado. Não houve alteração das configurações de segurança do Windows.

## Validação

- Build e lint aprovados; 781 testes passaram.
- Testes novos de transferência: destino inexistente/excluído, movimento para o mesmo workspace, persistência, retorno, perfil/PIN/privacidade preservados e estado original não modificado.
- Electron: arrastar entre grupos, mover de volta pela API do menu e preservar o mesmo renderer, cookie sintético e rascunho não enviado.
- Pacote real: cada uma das duas contas importadas foi movida para o outro workspace e devolvida ao grupo original. Ambas mantiveram o mesmo renderer e continuaram autenticadas e online, sem QR code. As preferências de privacidade do usuário foram preservadas. Evidência: `.test-results/move-live.json`.
- Desfoque: foto, vídeo e áudio exercitados em fixture, incluindo ativar/desativar a categoria; mensagens, hover, Alt e PIN continuam no smoke.
- O usuário confirmou nesta conversa que já testou mensagens e mídias nas duas sessões reais e que estão funcionando. Essa é uma validação manual do usuário, não uma alegação de inspeção automatizada de todos os conteúdos reais. Nenhuma conversa foi aberta para procurar exemplos e nenhum áudio/vídeo foi reproduzido por estes testes.

Evidências locais: `.test-results/move-tests.log`, `move-lint.log`, `move-package.log`, `personal-runtime.json` e `executable-icon.png`. Os limites da versão local e a auditoria de dependências permanecem registrados em `VALIDACAO-LOCAL.md`.
