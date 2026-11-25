/** Fullscreen + landscape helpers (Android/desktop Fullscreen API, iOS home-screen fallback). */
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: (opts?: unknown) => Promise<void> };

export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** inside the Android app (Capacitor): already full screen and landscape, natively */
export const isNativeApp = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
export const isStandalone = () =>
  isNativeApp() ||
  window.matchMedia?.('(display-mode: fullscreen)').matches ||
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export function fullscreenSupported() {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen() {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement) || isStandalone();
}

/** Must be called from a user gesture (tap / click). */
export function enterFullscreen() {
  const el = document.documentElement as FsEl;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    Promise.resolve(p)
      .then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o?.lock?.('landscape');
      })
      .catch(() => { /* not allowed – keep playing */ });
  } catch { /* ignore */ }
}

export function exitFullscreen() {
  const d = document as FsDoc;
  try {
    if (d.fullscreenElement) void d.exitFullscreen();
    else if (d.webkitFullscreenElement) void d.webkitExitFullscreen?.();
  } catch { /* ignore */ }
}

export function toggleFullscreen() {
  if (isFullscreen() && !isStandalone()) exitFullscreen();
  else enterFullscreen();
}
