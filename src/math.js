import { CONFIG } from './config.js';
export const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
export const lerp = (a, b, t) => a + (b - a) * t;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const normalize = (x, y) => {
  const n = Math.hypot(x, y);
  return n > 1e-8 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
};
export function rng(seed) {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  random.state = () => s;
  random.restore = (value) => {
    s = value >>> 0;
  };
  return random;
}
export function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    denom = dx * dx + dy * dy;
  const t = denom > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / denom, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export class FixedClock {
  constructor(step) {
    this.step = step;
    this.accumulator = 0;
    this.last = null;
    this.ticks = 0;
    this.dropped = 0;
  }
  reset() {
    this.last = null;
    this.accumulator = 0;
  }
  advance(now) {
    if (!Number.isFinite(now)) return 0;
    if (this.last === null) {
      this.last = now;
      return 0;
    }
    const elapsed = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.accumulator += Math.min(elapsed, CONFIG.simulation.maxFrame);
    const dt = 1 / CONFIG.simulation.hz;
    let n = 0;
    while (this.accumulator + 1e-10 >= dt && n < CONFIG.simulation.maxSteps) {
      this.accumulator -= dt;
      this.step(dt);
      this.ticks++;
      n++;
    }
    if (this.accumulator >= dt) {
      this.dropped += this.accumulator;
      this.accumulator %= dt;
    }
    return clamp(this.accumulator / dt, 0, 1);
  }
}
