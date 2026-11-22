# Refinamento 18 — Ciclo de vida das views

Estados: not_created → loading → active ↔ background → suspended / failed.

Sob pressão de memória, o teto de views continua adaptativo, mas uma view que acabou
de ir para segundo plano só entra no LRU depois de cumprir a ociosidade da pressão
atual. A troca de aba, sozinha, nunca deve hibernar imediatamente um WhatsApp.

O teto conta o CRM. CRM não nasce no boot se a sessão já estiver autenticada; após
o login, a view é hibernada na hora. Pin de mídia (YouTube/Spotify) cede em
high/critical sem áudio. Probe de formulário só olha o campo focado.
