// Hides the start screen from public/splash.js. Called by every view once its
// first data is shown; only the first call has an effect.
export function splashDone(): void {
  (window as { __nexoraSplashDone?: () => void }).__nexoraSplashDone?.();
}
