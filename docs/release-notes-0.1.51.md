# ADR Workspace 0.1.51

ADR Browser mais perto de um navegador de verdade: faixa de abas, atalhos do
Chrome, busca na página, zoom por site, corretor em português e um visual novo
na barra.

## Atualizar

Pela atualização automática (Configurações → Sobre → Buscar atualizações), ou
com o instalador por cima da versão atual — as sessões continuam logadas.

## Abas

- **Faixa de abas** no topo do ADR Browser, em sincronia com a barra lateral
  (cada aba é um ADR Browser da lateral): ícone e título do site, ✕, "+",
  arrastar para reordenar, clique do meio fecha, duplo clique no vazio abre.
- **Atalhos:** Ctrl+T (nova aba), Ctrl+W (fecha), Ctrl+Tab / Ctrl+PgDn /
  Ctrl+PgUp (alternar), Ctrl+Shift+T (reabrir a fechada, no mesmo endereço),
  Ctrl+Shift+K (duplicar).
- **Menu da aba** (botão direito): nova aba à direita, recarregar, duplicar,
  silenciar, fechar, fechar outras, fechar à direita, reabrir aba fechada.
- **Som na aba:** alto-falante na aba que toca; clique silencia.
- **Links "em nova aba"** abrem uma aba ao lado em vez de trocar a página;
  clique do meio / Ctrl+clique abre no fundo, em sequência.

## Barra de endereço e página

- **Buscar na página** (Ctrl+F, F3, Ctrl+G), começando pelo texto selecionado.
- **Imprimir** (Ctrl+P), **parar** carregamento (o ↻ vira ✕), ícone do site na
  barra, aviso **"Não seguro"** em páginas http.
- **Zoom por site** (Ctrl+= / Ctrl+- / Ctrl+roda) com indicador; clique volta a
  100%. Vale só nas abas do Browser.
- Ctrl+D favorita, Alt+D / F6 vão à barra, F5 / Ctrl+F5 recarregam, Esc desfaz
  o que foi digitado, Ctrl+Enter completa `www.___.com`, Enter devolve o
  teclado à página, primeiro clique seleciona o endereço inteiro.
- **Menu da página:** abrir link em nova aba, pesquisar a seleção no Google,
  voltar/avançar/recarregar, imprimir, copiar endereço.
- **Corretor ortográfico** em português e inglês, com sugestões e "Adicionar ao
  dicionário" no botão direito (vale também no WhatsApp, Gmail etc.).
- **Vídeo em tela cheia** cobre a janela inteira; Esc volta.

## Visual

Faixa mais funda que a barra com a aba ativa "saindo" dela, divisórias entre
abas, títulos que esmaecem, abas estreitas só com ícone, ícones desenhados no
lugar de caracteres, barra de endereço e busca em pílula, ferramentas do ADR
agrupadas, favoritos sem moldura, dicas com atalhos e foco visível no teclado.

## Correções

- Abas fechadas não se acumulam mais no estado do app (são apagadas ao iniciar).
- A faixa de abas não é mais redesenhada a cada contador do bloqueador de
  anúncios (cliques em aba/✕ podiam se perder).
- Pesquisa com emoji no limite do texto não derruba mais o menu.
- O favorito guarda o endereço da página, não o texto digitado na barra.
