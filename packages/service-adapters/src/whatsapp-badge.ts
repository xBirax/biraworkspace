/** Parse WhatsApp Web titles like "(3) Chat · WhatsApp" or "(12) WhatsApp". */
export function unreadFromWhatsAppTitle(title: string): number {
  const m = String(title || "").trim().match(/^\((\d{1,4})\)\s*/);
  if (!m) return 0;
  return Math.min(9999, Number.parseInt(m[1]!, 10) || 0);
}
