# ADR Workspace 0.1.43 — avaliação

Correção da janela de erro JavaScript que podia aparecer ao abrir o aplicativo.

- A atualização das listas de bloqueio de anúncios agora usa a rede do Electron, sem passar pelo parser HTTP do Node/Undici que aparece na captura do erro.
- Respostas HTTP de erro são encerradas e a lista local de reserva continua disponível quando a rede falha.
- Links abertos em novas janelas aceitam apenas páginas HTTP/HTTPS; `mailto:` usa o aplicativo de e-mail do sistema.
- Mensagens de console do CRM e dos serviços usam o formato atual do Electron 44.
- A conferência do instalador Windows passou a exercitar a rede do Electron com uma resposta HTTP de erro gerada localmente.

Nenhuma partição, cookie, perfil, PIN, cofre ou sessão foi migrado ou apagado.

## Instalar

Feche normalmente o ADR Workspace e instale por cima da versão 0.1.42, no mesmo usuário Windows. Não desinstale nem apague os dados.

Esta é uma versão de avaliação, com download manual.
