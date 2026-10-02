/** Shared by the server layout (pre-paint script) and the client toggle; must not be a client module. */
export const THEME_STORAGE_KEY = "dz-operator-theme";

/**
 * Runs in <head> before first paint: applies the saved theme, else the OS preference, so the page
 * never flashes the wrong theme. Storage can be unavailable (private mode, blocked site data).
 */
export const THEME_INIT_SCRIPT = `(function(){var t;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t})();`;
