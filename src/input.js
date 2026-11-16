import { CONFIG as C } from './config.js';
export class Input {
  constructor(canvas, action, canPlay) {
    this.keys = new Set();
    this.pointer = { x: innerWidth / 2 + 100, y: innerHeight / 2, down: false };
    this.commands = [];
    this.serial = 0;
    this.seq = 0;
    this.action = action;
    this.canPlay = canPlay;
    this.touch = { x: 0, y: 0 };
    this.abort = new AbortController();
    const opts = { signal: this.abort.signal };
    addEventListener(
      'keydown',
      (e) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement ||
          e.isComposing
        )
          return;
        if (!this.canPlay()) {
          if (e.code === 'Escape') this.action('escape');
          return;
        }
        this.keys.add(e.code);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
          e.preventDefault();
        if (e.repeat) return;
        const map = {
          Digit1: ['skill', 0],
          Digit2: ['skill', 1],
          Digit3: ['skill', 2],
          KeyJ: ['skill', 0],
          KeyK: ['skill', 1],
          KeyL: ['skill', 2],
          Space: ['dash'],
          KeyC: ['practice'],
          KeyH: ['potion'],
          KeyF: ['explore'],
        };
        if (map[e.code]) this.queue(...map[e.code]);
        else {
          const ui = {
            KeyB: 'breakthrough',
            KeyE: 'shop',
            KeyM: 'map',
            KeyT: 'team',
            Escape: 'escape',
          };
          if (ui[e.code]) this.action(ui[e.code]);
        }
      },
      opts
    );
    addEventListener('keyup', (e) => this.keys.delete(e.code), opts);
    addEventListener(
      'pointerup',
      () => {
        this.pointer.down = false;
      },
      opts
    );
    addEventListener('pointercancel', () => this.clear(), opts);
    addEventListener('blur', () => this.clear(), opts);
    canvas.addEventListener(
      'pointermove',
      (e) => {
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
      },
      opts
    );
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || !this.canPlay()) return;
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
        this.pointer.down = true;
      },
      opts
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
  }
  queue(type, value) {
    if (this.commands.length >= C.limits.maxQueuedInput) return false;
    this.commands.push({ n: ++this.serial, type, value });
    return true;
  }
  acknowledge(n) {
    this.commands = this.commands.filter((c) => c.n > n);
    this.serial = Math.max(this.serial, n);
  }
  read(player, renderer, blocked = false) {
    const aim = renderer.screenToWorld(this.pointer.x, this.pointer.y);
    const x = blocked
      ? 0
      : (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) +
        this.touch.x;
    const y = blocked
      ? 0
      : (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
        (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) +
        this.touch.y;
    return {
      seq: ++this.seq,
      x,
      y,
      aim: player ? Math.atan2(aim.y - player.y, aim.x - player.x) : -0.6,
      attack: !blocked && (this.pointer.down || this.keys.has('KeyU')),
      commands: this.commands.slice(0, C.simulation.maxCommands),
    };
  }
  clear() {
    this.keys.clear();
    this.pointer.down = false;
    this.touch.x = this.touch.y = 0;
  }
  reset() {
    this.clear();
    this.commands.length = 0;
    this.serial = 0;
    this.seq = 0;
  }
  destroy() {
    this.abort.abort();
  }
}
