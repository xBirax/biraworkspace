; ADR Workspace - passos extras do instalador NSIS (electron-builder: nsis.include).
;
; customInstall roda depois de os arquivos novos estarem no lugar, com o app
; fechado (o instalador o fecha antes de copiar) e ANTES de a versao nova abrir
; o perfil pela primeira vez: e o momento em que a copia do perfil e integra.
; Vale para instalacao manual e para a atualizacao automatica (silenciosa).
; Falha aqui nao interrompe a instalacao.
!macro customInstall
  IfFileExists "$APPDATA\ADR Workspace\state.v1.json" 0 adr_skip_backup
    DetailPrint "Copiando o perfil do ADR Workspace (backup)..."
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\backup-profile.ps1" -Label "auto-${VERSION}"'
    Pop $0
  adr_skip_backup:
!macroend
