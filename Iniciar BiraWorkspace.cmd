@echo off
set ELECTRON_RUN_AS_NODE=
set BIRA_TEST_HIDDEN=
set BIRA_TEST_PROFILE=
if exist "%~dp0apps\desktop\release\win-unpacked\biraworkspace.exe" (
  start "" "%~dp0apps\desktop\release\win-unpacked\biraworkspace.exe"
) else (
  echo Pacote local ainda nao encontrado. Consulte README.md.
  pause
)
