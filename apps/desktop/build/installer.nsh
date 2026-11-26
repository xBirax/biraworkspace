; BiraWorkspace - passos extras do instalador NSIS (electron-builder: nsis.include).
;
; customInstall roda depois de os arquivos novos estarem no lugar, com o app
; fechado (o instalador o fecha antes de copiar) e ANTES de a versao nova abrir
; o perfil pela primeira vez: e o momento em que a copia do perfil e integra.
; Vale para instalacao manual e para a atualizacao automatica (silenciosa).
; Falha aqui nao interrompe a instalacao.
!macro customInstall
  IfFileExists "$APPDATA\BiraWorkspace\state.v1.json" 0 adr_skip_backup
    DetailPrint "Copiando o perfil do BiraWorkspace (backup)..."
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\backup-profile.ps1" -Label "auto-${VERSION}"'
    Pop $0
    ${If} $0 != 0
      DetailPrint "Falha no backup do perfil. Consulte BiraWorkspace Backups."
      SetErrorLevel 1
    ${EndIf}
  adr_skip_backup:
!macroend
