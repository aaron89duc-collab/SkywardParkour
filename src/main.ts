import './ui/style.css';
import { Game } from './core/Game';
import { t, applyDocLang } from './i18n';

applyDocLang();

const app = document.getElementById('app')!;
const game = new Game(app);
game.init().catch((err) => {
  console.error(err);
  game.ui?.showError(t('load.error', { msg: String(err?.message ?? err) }));
});

// offline app shell for the web build (after the first visit the game opens without network).
// Not in dev, not inside a native wrapper (Capacitor serves the files from the app itself).
const native = !!(window as unknown as { Capacitor?: unknown }).Capacitor;
if (import.meta.env.PROD && !native && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('offline cache unavailable', e)); });
}
