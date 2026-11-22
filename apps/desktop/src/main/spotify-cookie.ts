/**
 * O Spotify emite sp_dc/sp_key SEM validade (medido: `sessao: true`,
 * `expiraEm: null`). Cookie de sessão nunca é gravado em disco, então o login
 * morre com o processo — é a causa do "Spotify pede login toda vez".
 *
 * A correção regrava o mesmo cookie com expiração. As três condições existem por
 * motivos diferentes, e cada uma some por um sintoma próprio:
 *  - `session`: é o guarda de recursão. O cookie regravado tem `session: false`,
 *    então não reentra. Sem isto, toda regravação dispara outra, para sempre.
 *  - `!removed`: `changed` também dispara na REMOÇÃO; regravar aí ressuscitaria
 *    um cookie que o Spotify (ou o logout do usuário) acabou de apagar.
 *  - a lista de nomes: sp_adid é rastreio de anúncio e não tem nada que ver com
 *    login. Prolongar a validade dele seria o oposto do que se quer.
 */
export function shouldPersistSpotifyCookie(cookie: {
  name: string;
  session?: boolean;
}, removed: boolean): boolean {
  if (removed || !cookie.session) return false;
  return cookie.name === "sp_dc" || cookie.name === "sp_key";
}
