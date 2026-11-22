# Integração Lusha

O ADR Workspace consulta a Lusha através do backend autenticado do CRM. A barra
do ADR Browser exibe o botão `L`; ele só consulta quando a página atual é um
perfil `https://www.linkedin.com/in/...`.

## Configuração

A chave fica configurada no CRM em `Admin > Integrações`, armazenada no snapshot
criptografado do tenant. O Workspace não precisa de `LUSHA_API_KEY` local, não
recebe a chave e não a inclui no instalador. Basta entrar no CRM; o gate de
sessão libera a consulta somente depois do login pessoal.

## Fluxo

1. Abra manualmente um perfil do LinkedIn no ADR Browser.
2. Clique em `L`.
3. O Workspace encaminha `linkedinUrl` para `/api/crm/lusha/contact`; o CRM faz a
   busca V3 e exibe o preview sanitizado em card flutuante dentro do navegador.
4. Ao clicar em `Revelar e-mail e telefone` no card, ele chama o enriquecimento
   pela rota autenticada e exibe e-mails e telefones com botões de cópia direta
   e texto selecionável. A ação pode consumir créditos da conta Lusha.
5. Depois da revelação, `Preparar negócio` cria no CRM uma intenção temporária de
   15 minutos e abre o formulário nativo `Criar Negócio`. Somente um token opaco
   aparece na URL; nome, e-mail, telefone e IDs internos permanecem no servidor.
6. O formulário reaproveita o motor de deduplicação do CRM. E-mail, telefone e
   LinkedIn exatos podem sugerir uma pessoa existente; nome de empresa sozinho
   nunca vincula automaticamente. Negócios abertos relacionados geram aviso.
   Usuário revisa pessoa, empresa, pipeline, etapa e próximo passo antes de salvar.

A rota exige `crm.deals.create`. Consultar, revelar e preparar não criam nem alteram
lead, pessoa, empresa ou negócio; escrita só ocorre no formulário CRM após confirmação.
A rota antiga `/api/crm/leads/lusha` continua reservada à ingestão explícita de
empresas por domínio.

Esta integração não raspa listas, conexões, mensagens nem o DOM do LinkedIn. A
extensão oficial da Lusha continua sendo uma opção separada em Chrome/Edge; ela
não é carregada como extensão arbitrária dentro do Electron.

## Gate do CRM

Ao iniciar, o Workspace abre o CRM. WhatsApp, ADR Browser e demais serviços só são
liberados quando a partição CRM do workspace contém uma sessão autenticada com
`auth_token`. Configurações permanece acessível sem login para diagnóstico e
atualização, evitando bloquear a recuperação do app. O cookie `tenant_id` é opcional,
pois o CRM resolve o tenant padrão no servidor; sessões em impersonação continuam
bloqueadas. Ao trocar de workspace, o gate é recalculado; se a sessão desaparecer,
o app retorna ao CRM.
