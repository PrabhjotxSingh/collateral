import { RULES } from "../../shared/rules.js";
// Predict presentation only. Health and hit markers remain server-owned.
export class ShotPrediction {
  private nextId = 0;
  private last = -Infinity;
  private pending = new Map<number, number>();
  request(now: number, ammo: number, shotSeconds: number = RULES.shotSeconds) {
    for (const [id, time] of this.pending)
      if (now - time > 2000) this.pending.delete(id);
    if (now - this.last < shotSeconds * 1000 || ammo <= this.pending.size)
      return;
    this.last = now;
    const id = ++this.nextId;
    this.pending.set(id, now);
    return id;
  }
  acknowledge(id?: number) {
    return id === undefined ? false : this.pending.delete(id);
  }
  reset() {
    this.pending.clear();
    this.last = -Infinity;
  }
}
