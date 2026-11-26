# Privacidade do BiraWorkspace — redesenho de 17/11/2026

## Usar

- **Olho / Privacidade** na barra lateral: abre o painel por sessão. Atalho `Ctrl+Shift+P`.
- **Ativar desfoque**: preserva a estrutura do WhatsApp. Por padrão, desfoca prévias e mídias; nomes, fotos e texto das mensagens têm controles próprios. O campo de escrita continua livre.
- **Revelar ao passar o mouse**: o elemento fica legível enquanto o ponteiro está sobre ele, sem prazo de cinco segundos. Ao sair, volta a desfocar.
- **Segurar Alt**: alternativa que revela o elemento sob o ponteiro somente enquanto Alt estiver pressionado. Escape, saída de foco e mudança no conteúdo revelado revogam a revelação.
- **Ocultar agora**: cobre todas as sessões e silencia o áudio; atalho `Ctrl+Shift+H`. A tela informa que o WhatsApp está oculto e oferece **Voltar às conversas**. O retorno recupera o desfoque e o áudio anteriores.
- O **PIN** continua separado. Voltar da ocultação não desbloqueia uma sessão protegida por PIN.

Com desfoque ativo, as notificações da sessão são suprimidas. Quando a estrutura da página não é reconhecida, o conteúdo permanece coberto e há uma ação explícita para desligar o desfoque.

## Referências

Interação de desfoque por categoria e hover: [Privacy Extension for WhatsApp Web](https://pfwa.lukaslen.com/). Separação entre bloqueio e privacidade: [Rambox](https://support.rambox.app/faqs/how-to-set-and-remove-your-master-password.html). Estado explícito e controle de notificações: [Discord Streamer Mode](https://support.discord.com/hc/en-us/articles/218485407-Streamer-Mode-101).

A implementação é própria. Não instala extensões nessas contas. Não implementa bloqueio de captura de tela do Signal nem detecção automática de OBS/compartilhamento.

## Validação neste PC

- Compilação e lint aprovados. Suíte: 778 testes (621 desktop e 157 nos demais pacotes).
- Electron real com perfil sintético: categorias, compositor livre, rejeição de hover sintético, hover confiável sem cronômetro, atualização externa sem interrupção, Alt pressionado/solto e deslocamento entre elementos, painel, persistência, ocultação/retorno, áudio restaurado e PIN acima da camada de privacidade.
- Duas sessões reais: ambas autenticadas e online, sem QR code. Foram encontrados 119 elementos de prévia na primeira lista e 38 na segunda, nas condições do teste. A inspeção guardou apenas contagens/estrutura, sem conteúdo das mensagens e sem envio.
- Evidências locais: `.test-results/redesign-tests.log`, `redesign-final-lint.log`, `personal-runtime.json`, `privacy-live.json` e `redesign-package-final.log`.

A validação real acima cobre autenticação e lista de conversas. Fotos, vídeos, documentos, chamadas, visualizadores e layouts futuros do WhatsApp não têm homologação exaustiva; mídias e texto também foram exercitados no fixture. Desfoque visual não é criptografia ou proteção contra o próprio site. Os alertas de dependências e a ausência de assinatura de distribuição registrados na validação inicial continuam pendentes.
