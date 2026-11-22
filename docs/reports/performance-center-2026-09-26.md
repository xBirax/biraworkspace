# Central de Desempenho — implementação e revisão de segurança

Data: 26/09/2026
Base: `9c9c794`, branch `codex/internal-usability-review`
Checkout: `/tmp/adrworkspace-native-full`

## Estado da entrega

A página **Desempenho** está dentro de Configurações, com Visão geral,
Recomendações, Limpeza e Histórico. A análise é manual e local; a abertura do app
não executa alterações. Ações disponíveis passam por seleção, prévia com validade
de dez minutos, revalidação e execução registrada. O histórico permite restaurar
ajustes suportados quando o valor atual ainda corresponde ao aplicado.

O executor anterior que copiava PowerShell para `%LOCALAPPDATA%\ADRBooster` e o
elevava via UAC foi removido da aplicação e do pacote. O helper Rust novo roda no
contexto do usuário, aceita catálogo fechado e não executa script nem comando
fornecido pelo renderer. Os canais IPC de Desempenho aceitam apenas o painel
interno; as opções que abrem Configurações do Windows usam uma lista fixa de URIs.

| Capacidade | Estado nesta revisão |
|---|---|
| CPU, memória, processos do Workspace e volume do perfil | Coleta local de 15 segundos; primeira leitura de CPU serve de base; falhas aparecem como dados indisponíveis. Processos são identificados por PID e criação e somados uma vez. |
| Hibernação de serviços inativos | Revalida atividade imediatamente antes de fechar cada view. Áudio, login Google, edição, download em andamento e “manter sempre ativo” impedem a ação. Views cujo estado não pôde ser lido são preservadas. |
| Limite de views | Recomenda o limite já definido pela RAM no aplicativo, registra o anterior e só restaura se o valor ainda for o aplicado. |
| Inicialização do usuário | Helper limitado a `HKCU\...\Run` e `StartupApproved\Run`; compara os valores atuais com a prévia, preserva valor/tipo e detecta conflitos na restauração. Exige validação funcional em Windows isolado. |
| Energia | Somente planos existentes podem ser escolhidos; nenhum é ativado automaticamente. Exige validação de permissões e bateria em Windows isolado. |
| Limpeza de temporários | Disponível somente após varredura íntegra e confirmação própria de exclusão definitiva. O módulo nativo limita escopo ao Temp do usuário, idade a sete dias, análise a 100 mil entradas/60 segundos, ignora reparse points e hard links e revalida identidade por handle. Nova varredura é feita na prévia e na execução; diferenças recusam a exclusão. O histórico separa bytes removidos de espaço livre. Ainda exige smoke em Windows isolado antes de recomendar uso cotidiano. |
| Backup `ADRBooster/backup.json` | Importação apenas para registro legado **não verificado**, sem editar o original. Duplicatas mantêm a primeira entrada válida. Valores sensíveis não são exportados. Restauração automática do legado ainda indisponível. |
| Administração | **Fase posterior.** Requer helper e instalador com Authenticode, diretório protegido, UAC explícito, catálogo fechado, diário protegido e canal local autenticado. Não existe fallback elevado. |

## Revisão de riscos

1. **Sessões e dados locais:** nenhuma operação nova remove perfis Electron,
   cookies, IndexedDB, cofre/PIN, backups de recuperação ou Downloads. A
   hibernação mantém as partições, mas uma chamada, formulário ou transferência
   não pode ser interpretada como ociosidade. Falha da sonda bloqueia a ação.
2. **Escalada de privilégio:** o caminho antigo `system-boost` foi removido do
   código e dos `extraResources`. O helper de usuário não solicita UAC. A fase
   administrativa depende de assinatura Authenticode e não deve reutilizar a
   assinatura VMP da CastLabs como prova de editor.
3. **IPC e entrada:** o renderer seleciona apenas IDs anunciados pelo processo
   principal; não fornece script, caminho de arquivo, chave de registro ou
   backup arbitrário. O helper rejeita operações e campos desconhecidos.
4. **Concorrência e falhas:** uma mutação por vez, com diário durável antes da
   alteração. Falha ou encerramento entre diário e confirmação fica marcada
   como interrompida, exigindo conferência; não se presume sucesso. Conflito
   de valor atual impede restauração silenciosa.
5. **Limpeza:** o Temp foi obtido pela pasta conhecida do Windows, não por uma
   variável de ambiente. O digest da prévia vincula caminho relativo, ID do
   arquivo, tamanho e horário de modificação. Na exclusão, handles de pastas
   impedem troca de ancestrais e o arquivo é reaberto sem compartilhamento para
   escrita ou renomeação. A interface não seleciona a limpeza por padrão e exige
   confirmação separada. Se a execução for interrompida, o estado é marcado
   para verificação; bytes parcialmente removidos não são presumidos como zero.

## Validação

No Linux deste checkout: `corepack pnpm build`, `typecheck`, `lint` e `test`
passaram em todo o monorepo; o Desktop executou 214 testes e o pacote de ciclo
de views, 26. `cargo check --target x86_64-pc-windows-gnu --locked --tests`
passou, assim como a verificação de formatação Rust. A fixture visual Electron
passou em 84 cenários de largura, tema, escala e seção, sem overflow ou erro de
console. Ela usa dados sintéticos e não toca sessões reais.

O CI Windows anterior validou o helper com uma pasta isolada; os testes adicionais
de arquivo aberto, link de pasta e mudança após prévia ainda devem rodar no novo
commit. Faltam execução manual em Windows, instalador e smoke em desktop e
notebook. O coletor mede somente o volume que contém o perfil do Workspace; a
varredura por todas as unidades continua pendente. O histórico ainda não permite
excluir entradas encerradas. Se uma execução cair com o lock de mutação ativo,
ações futuras ficam bloqueadas até inspeção manual do estado e do diário; não há
reconciliação automática. Essas pendências impedem a promoção para estável.

## Recuperação

- Use **Configurações → Desempenho → Histórico** para conferir cada resultado.
  Só ações com restauração suportada oferecem **Restaurar**; se outro programa
  mudou o valor depois, a restauração recusa sobrescrevê-lo.
- Exporte o relatório na mesma página antes de investigar uma falha. Ele inclui
  estados e comparação de medições, sem comandos originais do backup legado.
- Uma execução interrompida deve ser conferida em Windows antes de tentar um
  novo ajuste. Preserve o diário em `app.getPath("userData")/performance-runs`
  e o `backup.json` legado intactos; não edite esses arquivos manualmente.
- Para retornar ao instalador anterior, feche normalmente o Workspace e instale
  por cima no mesmo usuário. Não desinstale o app nem apague o perfil local; os
  logins residem nas partições desse perfil.

## Gates antes da publicação estável

Executar em Windows 11 x64 e Windows 10 22H2 isolados: usuário comum,
administrador, UAC com outra conta, desktop e notebook na tomada/bateria.
Conferir sessões WhatsApp/CRM/Google após atualização, PIN e recuperação;
startup HKCU, troca/restauração de plano de energia, cancelamento, restauração
com conflito, concorrência e processo interrompido. Testar a limpeza somente em
Temp de perfil de teste, com arquivos recentes/abertos, Unicode, caminho longo,
junction, hard link e troca de alvo. Verificar também instalação, atualização
interna, teclado, 80%–200%, claro/escuro e regressão Linux. Manter o instalador
anterior disponível.

Não inferir ganho de desempenho de uma ação concluída. A comparação mostra
somente a variação observada nos dois intervalos de medição.
