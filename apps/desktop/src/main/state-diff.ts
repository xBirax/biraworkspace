/**
 * Diferença entre o último estado enviado às telas do shell e o atual, por
 * chave de primeiro nível. Comparação por JSON: o estado é serializável (vai
 * por IPC), e chaves pequenas custam pouco; o ganho é não reenviar nem
 * redesenhar o que não mudou (catálogo, feed, contas...).
 *
 * `changed` é null quando nada mudou. Chave que sumiu vai como `undefined`,
 * para a tela mesclar e apagar o valor velho.
 */
export function stateDiff(
  previous: Readonly<Record<string, string>>,
  next: Readonly<Record<string, unknown>>,
): { changed: Record<string, unknown> | null; snapshot: Record<string, string> } {
  const snapshot: Record<string, string> = {};
  const changed: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of Object.entries(next)) {
    const json = JSON.stringify(value) ?? "undefined";
    snapshot[key] = json;
    if (previous[key] !== json) {
      changed[key] = value;
      any = true;
    }
  }
  for (const key of Object.keys(previous)) {
    if (!(key in snapshot)) {
      changed[key] = undefined;
      any = true;
    }
  }
  return { changed: any ? changed : null, snapshot };
}
