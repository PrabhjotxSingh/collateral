import type { Settings } from "./settings";

export class MenuMusic {
  private audio = new Audio("/assets/music/menu-theme.mp3");
  private unlocked = false;
  private fadeFrame = 0;
  private target = 0;
  constructor(private settings: () => Settings) {
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.volume = 0;
    const unlock = () => {
      this.unlocked = true;
      this.sync();
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    new MutationObserver(() => this.sync()).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  sync() {
    const shouldPlay =
      this.unlocked && document.body.classList.contains("is-menu");
    const current = this.settings();
    const next = shouldPlay
      ? Math.min(0.45, current.master * (current.music ?? 1) * 0.5)
      : 0;
    if (shouldPlay && this.audio.paused) void this.audio.play().catch(() => {});
    if (next === this.target) return;
    this.target = next;
    cancelAnimationFrame(this.fadeFrame);
    const start = this.audio.volume,
      end = this.target;
    const duration = end > start ? 1800 : 1100;
    const began = performance.now();
    const fade = (now: number) => {
      const t = Math.min(1, (now - began) / duration),
        ease = t * t * (3 - 2 * t);
      this.audio.volume = start + (end - start) * ease;
      if (t < 1) this.fadeFrame = requestAnimationFrame(fade);
      else if (end === 0) this.audio.pause();
    };
    this.fadeFrame = requestAnimationFrame(fade);
  }
}
