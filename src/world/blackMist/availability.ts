/**
 * Black Mist is withheld from players until its memory use is stable: the browser's GPU process repeatedly ran out
 * of memory while the mode's creatures loaded. Its code and assets stay in place; DEV builds can opt back in with
 * `?blackMist` so fixes and the verification scripts still reach it.
 */
export const BLACK_MIST_AVAILABLE = import.meta.env.DEV && new URLSearchParams(window.location.search).has('blackMist')
