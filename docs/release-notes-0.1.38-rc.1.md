# ADR Workspace 0.1.38 — avaliação

Correção da navegação e do diagnóstico do login Google.

- Preserva a página original do Google e suas opções de recuperação, em vez de substituí-la pelo cartão do Workspace.
- Remove falsos alertas disparados por texto de e-mails, documentos e resultados de busca.
- Restringe o diagnóstico de rejeição à origem e às rotas de autenticação Google, sem registrar dados de login.
- Ignora navegações de subframes ao atualizar a navegação principal.

O login Gmail no Windows ainda precisa de avaliação humana. Esta versão não garante que o Google aceite autenticação no navegador incorporado.

## Instalação

Feche normalmente o ADR Workspace e execute o instalador sobre a instalação atual, no mesmo usuário Windows. Não desinstale nem apague os dados do aplicativo. Identidade, diretório de dados e partições de sessão permanecem iguais; não há migração nem limpeza de sessões.

Esta é uma versão de avaliação, disponível por download manual. Os instaladores anteriores continuam disponíveis. Instalar uma versão anterior não garante reversão de dados; não há migração de formato neste ajuste.

## Avaliação

Abra o Gmail e confira a resposta original do Google. Valide também que WhatsApp e CRM continuam autenticados. Nunca envie senha, cookies ou URLs completas de autenticação no diagnóstico.
