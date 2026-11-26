/* global document, location, window, MutationObserver */
(() => {
  if (location.origin !== 'https://web.whatsapp.com' || window !== window.top) return;
  const { ipcRenderer } = require('electron');
  const marker = 'audio,[data-icon*="ptt" i],[data-icon*="audio" i],[aria-label*="mensagem de voz" i],[aria-label*="voice message" i]';
  const selector = '[data-bira-transcript]';
  const cache = new Map();
  const entries = new WeakMap();
  let enabled = false, running = false, dirty = false, version = 0, timer, observer;

  function schedule() {
    if (enabled && !timer) timer = setTimeout(() => { timer = null; void scan(); }, 120);
  }

  function render(node, result) {
    node.replaceChildren();
    node.dataset.state = result.text ? 'ready' : (result.error || 'pending');
    if (result.text) {
      const heading = document.createElement('strong');
      heading.textContent = 'Transcrição';
      node.append(heading, document.createElement('br'), document.createTextNode(result.text));
    } else if (result.error === 'skip' || result.error === 'gone') {
      node.hidden = true;
    } else if (result.error) {
      node.textContent = result.error === 'long' ? 'O limite por áudio é de 10 minutos ou 32 MB.' :
        (result.error === 'engine' ? 'Whisper local indisponível. ' : 'Não foi possível transcrever. ');
      if (result.error !== 'long') {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = 'Tentar novamente';
        retry.onclick = event => { event.stopPropagation(); node.remove(); schedule(); };
        node.append(retry);
      }
    } else node.textContent = 'Transcrevendo áudio…';
  }

  async function scan() {
    if (running) { dirty = true; return; }
    if (!enabled || document.hidden) return;
    running = true;
    const current = version;
    try {
      for (const bubble of document.querySelectorAll('#main [data-id]')) {
        if (current !== version || !enabled || document.hidden) break;
        const rect=bubble.getBoundingClientRect();
        if (!rect.height || rect.bottom<=0 || rect.top>=window.innerHeight) continue;
        const id = bubble.dataset.id;
        const existing = bubble.querySelector(selector);
        if (existing && entries.get(existing) === id) continue;
        existing?.remove();
        if (!bubble.isConnected || !bubble.querySelector(marker)) continue;
        const node = document.createElement('div');
        node.dataset.biraTranscript = '';
        node.style.cssText = 'margin:5px 8px;padding:5px 8px;border-inline-start:2px solid currentColor;font-size:13px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;max-width:42ch';
        entries.set(node, id);
        const host = bubble.querySelector('.copyable-text') || bubble;
        host.append(node);
        if (cache.has(id)) { render(node, {text:cache.get(id)}); continue; }
        render(node, {});
        let result;
        try { result = await ipcRenderer.invoke('bira:transcribe-voice', id); }
        catch { result = { error:'unavailable' }; }
        if (current !== version) break;
        if (document.hidden) {node.remove();break;}
        if (result.error==='gone') {node.hidden=true;node.dataset.state='gone';continue;}
        if (result.text) {
          cache.set(id, result.text);
          if (cache.size > 150) cache.delete(cache.keys().next().value);
        }
        if (bubble.isConnected && bubble.dataset.id === id) render(node, result);
      }
    } finally { running = false; if (dirty) { dirty = false; schedule(); } }
  }

  function toggle(value) {
    version++;
    enabled = value === true;
    observer?.disconnect();
    clearTimeout(timer); timer = null;
    document.querySelectorAll(selector).forEach(n => n.remove());
    cache.clear();
    if (enabled && document.documentElement) {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { subtree:true, childList:true, attributes:true, attributeFilter:['data-id','data-icon','aria-label'] });
      schedule();
    }
  }
  document.addEventListener('scroll',schedule,true);
  function resumeVisible() {
    if (document.hidden) return;
    document.querySelectorAll('[data-bira-transcript][data-state="gone"]').forEach(node=>node.remove());
    schedule();
  }
  document.addEventListener('visibilitychange',resumeVisible);
  ipcRenderer.on('bira:privacy-mode',(_event,mode)=>{if(mode!=='presentation')resumeVisible();});
  ipcRenderer.on('bira:transcription-enabled', (_event, value) => toggle(value));
  async function start() {
    const initial = version;
    const value = await ipcRenderer.invoke('bira:transcription-status').catch(() => false);
    if (version === initial) toggle(value);
    else if (enabled) toggle(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else void start();
})();
