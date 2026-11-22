# ADR Workspace 0.1.47-rc.1

- **Claude** em **Adicionar serviço**: login próprio, sessão persistente separada
  por conta e duplicação em nova sessão.
- **Gemini** em **Adicionar serviço**: usa a sessão Google do workspace (abre já
  logado na conta do Gmail); "outra conta Google" cria sessão separada.
- Logo oficial do ChatGPT na barra lateral; ChatGPT ganha **Renomear**.
- Claude e Gemini podem pedir microfone para o modo de voz.
- RAM: a barra do ADR Browser só carrega quando um serviço com barra (ADR
  Browser/Instagram) é aberto, em vez de ficar residente desde o boot.

Smoke: `docs/windows-release-smoke.md`, incluindo login Claude/Gemini e a barra
do ADR Browser (endereço, voltar/avançar, Ctrl+L).
