/* global location, document, CSS, window, OfflineAudioContext */
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The host evaluates this function expression with the current message ID.
(async function readVoice(id, signal) {
  if (location.origin !== 'https://web.whatsapp.com') return { error: 'unavailable' };
  const bubble = document.querySelector('#main [data-id="' + CSS.escape(id) + '"]');
  if (!bubble) return { error: 'gone' };
  for (let i = 0; i < 100 && !signal?.aborted && !window.WPP?.isReady; i++)
    await new Promise(resolve => setTimeout(resolve, 100));
  // Some WhatsApp builds put only the unqualified message ID on the bubble.
  if (signal?.aborted) return { error: 'gone' };
  const chat = await window.WPP.chat.getActiveChat();
  const message = /^(true|false)_/.test(id) ? await window.WPP.chat.getMessageById(id) :
    chat?.msgs?.getModelsArray().find(item => item.id?.id === id);
  if (!message || !['ptt', 'audio'].includes(message.type) || message.isViewOnce || message.mediaData?.isViewOnce)
    return { error: 'skip' };
  if (Number(message.duration) > 600 || Number(message.size) > 32 * 1024 * 1024) return { error: 'long' };
  if (signal?.aborted) return { error: 'gone' };
  const blob = await window.WPP.chat.downloadMedia(message.id._serialized);
  if (signal?.aborted) return { error: 'gone' };
  if (!(blob instanceof Blob) || !blob.size) return { error: 'unavailable' };
  if (blob.size > 32 * 1024 * 1024) return { error: 'long' };
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const bytes = await blob.arrayBuffer();
  if (signal?.aborted) return { error: 'gone' };
  const audio = await ctx.decodeAudioData(bytes);
  if (signal?.aborted) return { error: 'gone' };
  if (audio.duration > 600) return { error: 'long' };
  const channels = Array.from({length: audio.numberOfChannels}, (_, i) => audio.getChannelData(i));
  const pcm = new Int16Array(audio.length);
  for (let i = 0; i < pcm.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    pcm[i] = Math.round(32767 * Math.max(-1, Math.min(1, sum / channels.length)));
  }
  if (!bubble.isConnected || bubble.dataset.id !== id) return { error: 'gone' };
  return { pcm: pcm.buffer, chatId:chat?.id?._serialized };
})
