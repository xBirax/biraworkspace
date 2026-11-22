# ADR Workspace 0.1.52

Correção do fechamento do app na Chrome Web Store, barra de endereço em todos
os serviços e importação das senhas do Bitwarden no Cofre ADR.

## Atualizar

Pela atualização automática (Configurações → Sobre → Buscar atualizações), ou
com o instalador por cima da versão atual — as sessões continuam logadas.

## Correções

- **O app não fecha mais ao abrir a Chrome Web Store** (por exemplo, a página
  do Bitwarden) no ADR Browser. A loja derrubava o processo principal do
  Electron; agora ela abre no navegador externo, com um aviso, venha de link,
  janela, redirecionamento, endereço digitado, favorito ou "abrir em nova aba".
  O ADR Browser não instala extensões.
- **Registro de crash local:** se o app fechar sozinho de novo, fica um
  relatório em `%APPDATA%\ADR Workspace\Crashpad\reports`, só no computador —
  nada é enviado.

## Barra de endereço

- Aparece em todos os serviços (Gmail, YouTube, Agenda, ChatGPT, Notion…),
  menos no WhatsApp, para copiar e colar o link da página aberta.
- Botão direito no campo de endereço: recortar, copiar, colar e selecionar tudo.
- Os atalhos de navegador (Ctrl+F/P/D/L, F3, F6) continuam só no ADR Browser,
  no Instagram e fora do site do serviço — no Notion, por exemplo, Ctrl+P
  segue sendo a busca dele.

## Cofre ADR

- **Importa o CSV exportado pelo Bitwarden** (Ferramentas → Exportar cofre →
  `.csv`), além do formato do Chrome/Edge/Brave. Notas seguras e cartões são
  ignorados; de um login com vários endereços vale o primeiro endereço web.
- Endereço salvo sem `https://` ("exemplo.com") passa a ser aceito.
- Depois de conferir os logins, apague o CSV: ele guarda as senhas em texto.
