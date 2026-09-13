// Single authority for the full-screen #loading-screen overlay. Both the map
// download (network.ts/main.ts) and the local bake/asset pipeline (game.ts)
// report into this, so neither can clobber the other's label mid-sequence.
export function setLoading(active: boolean, label = '', progress?: number, detail = '') {
  document.body.classList.toggle('map-loading', active);
  if (!active) return;
  const screen = document.getElementById('loading-screen');
  const labelEl = document.getElementById('loading-label');
  const detailEl = document.getElementById('loading-detail');
  if (labelEl) labelEl.textContent = label;
  if (detailEl) detailEl.textContent = detail;
  if (!screen) return;
  if (progress === undefined) {
    screen.classList.remove('determinate');
  } else {
    screen.classList.add('determinate');
    screen.style.setProperty('--progress', `${Math.max(0, Math.min(100, progress))}%`);
  }
}
// Yields until the browser has had a chance to paint whatever was just set
// above — without this, a synchronous bake/cook can block the main thread
// before the label/bar update ever reaches the screen.
export const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
