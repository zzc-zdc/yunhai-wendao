import { CONFIG as C } from './config.js';
import { clamp, rng } from './math.js';
const TAU = Math.PI * 2;
export function circle(g, x, y, r, color, width = 1) {
  if (r <= 0) return;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  if (width === 0) {
    g.fillStyle = color;
    g.fill();
  } else {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  }
}
export function star(g, x, y, r, color, rotation = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rotation);
  g.beginPath();
  g.moveTo(0, -r);
  g.lineTo(r * 0.22, -r * 0.22);
  g.lineTo(r, 0);
  g.lineTo(r * 0.22, r * 0.22);
  g.lineTo(0, r);
  g.lineTo(-r * 0.22, r * 0.22);
  g.lineTo(-r, 0);
  g.lineTo(-r * 0.22, -r * 0.22);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.restore();
}
export function blade(g, x, y, angle, length, color, alpha = 1) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(length, 0);
  g.lineTo(0, -3.4);
  g.lineTo(-length * 0.3, 0);
  g.lineTo(0, 3.4);
  g.closePath();
  g.fill();
  g.strokeStyle = '#fcffe6';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-8, 0);
  g.lineTo(length * 0.85, 0);
  g.stroke();
  g.restore();
}
export class Effects {
  constructor() {
    this.random = rng(9502);
    this.pool = Array.from({ length: C.limits.particles }, () => ({ active: false }));
    this.cursor = 0;
    this.active = 0;
    this.effects = [];
    this.texts = [];
    this.glows = new Map();
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#e7efd5';
    this.quality = 1;
    this.hitstop = 0;
    this.localId = 'local';
    this.zone = 0;
  }
  glow(color) {
    if (this.glows.has(color)) return this.glows.get(color);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'),
      grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, color);
    grad.addColorStop(0.15, color + 'c0');
    grad.addColorStop(0.45, color + '30');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.glows.set(color, c);
    return c;
  }
  emitParticle(
    x,
    y,
    color,
    kind = 'spark',
    speed = 150,
    life = 0.7,
    angle = this.random() * TAU,
    size = 2
  ) {
    if (this.active >= Math.floor(C.limits.particles * this.quality)) return;
    let p;
    for (let i = 0; i < this.pool.length; i++) {
      this.cursor = (this.cursor + 1) % this.pool.length;
      if (!this.pool[this.cursor].active) {
        p = this.pool[this.cursor];
        break;
      }
    }
    if (!p) return;
    Object.assign(p, {
      active: true,
      x,
      y,
      px: x,
      py: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      kind,
      life,
      maxLife: life,
      angle,
      size,
      spin: (this.random() - 0.5) * 6,
    });
    this.active++;
  }
  burst(x, y, color, count = 25, kind = 'spark', speed = 190) {
    for (let i = 0; i < count * this.quality; i++)
      this.emitParticle(
        x,
        y,
        color,
        kind,
        speed * (0.2 + this.random()),
        0.35 + this.random() * 0.7,
        this.random() * TAU,
        1 + this.random() * 3
      );
  }
  add(type, v, life) {
    if (this.effects.length < C.limits.effects)
      this.effects.push({ ...v, type, age: 0, life, seed: this.random() * 1000 });
  }
  text(x, y, text, color, big = false) {
    if (this.texts.length >= C.limits.floatingText) this.texts.shift();
    this.texts.push({
      x,
      y,
      text,
      color,
      big,
      age: 0,
      life: big ? 1.4 : 1,
      drift: (this.random() - 0.5) * 24,
    });
  }
  handle(e) {
    if (e.zone !== undefined && e.zone !== this.zone) return;
    const own = e.player === this.localId;
    if (e.type === 'cast') {
      const sk = C.skills[e.skill];
      this.add('skill', e, sk.windup + sk.duration);
      this.burst(e.ox, e.oy, sk.color, 12, 'diamond', 90);
    }
    if (e.type === 'release') {
      const sk = C.skills[e.skill];
      this.burst(
        e.x,
        e.y,
        sk.color,
        sk.style === 'judgment' ? 150 : 45,
        ['lotus', 'gust'].includes(sk.style) ? 'leaf' : 'spark',
        sk.radius || 230
      );
      if (own) {
        this.shake = Math.max(this.shake, sk.style === 'judgment' ? 13 : 5);
        this.flash = Math.max(this.flash, 0.07);
        this.flashColor = sk.color;
      }
    }
    if (e.type === 'hit') {
      this.burst(
        e.x,
        e.y,
        e.color || '#eddbb2',
        e.critical ? 25 : 12,
        'spark',
        e.critical ? 260 : 170
      );
      this.add('impact', e, 0.32);
      this.text(
        e.x,
        e.y - 24,
        String(e.amount) + (e.critical ? '!' : ''),
        e.critical ? '#ffdc8b' : '#f4eee0',
        e.critical
      );
      if (own) {
        this.shake = Math.max(this.shake, e.critical ? 5 : 2);
        this.hitstop = 0.035;
      }
    }
    if (e.type === 'hurt') {
      this.burst(e.x, e.y, '#e88378', 18, 'spark');
      this.text(e.x, e.y - 38, '−' + e.amount, '#ff9e91');
      if (own) {
        this.shake = 6;
        this.flash = 0.13;
        this.flashColor = '#b33e40';
      }
    }
    if (e.type === 'death' || e.type === 'playerDeath') {
      this.burst(e.x, e.y, e.boss ? '#ecd399' : '#88bbad', e.boss ? 100 : 40, 'shard', 220);
      this.add('death', e, 1.1);
      if (e.boss) {
        this.flash = 0.17;
        this.shake = 10;
        this.text(e.x, e.y - 60, '妖魄已灭', '#f4d58f', true);
      }
    }
    if (e.type === 'pickup') {
      this.burst(e.x, e.y, '#f4d58f', 13, 'diamond', 90);
      this.text(e.x, e.y - 15, `+${e.coins} 灵石`, '#f0d49c');
    }
    if (
      ['heal', 'purchase', 'forge', 'explore', 'revive', 'travel', 'spawn', 'summon'].includes(
        e.type
      )
    ) {
      const color = ['heal', 'revive'].includes(e.type) ? '#b7edbd' : '#efd395';
      this.add('ripple', { ...e, color }, 1);
      this.burst(e.x, e.y, color, e.type === 'explore' ? 70 : 24, 'diamond', 130);
    }
    if (e.type === 'dash') {
      this.add('dash', e, 0.4);
      this.burst(e.x, e.y, '#b9ddd7', 20, 'leaf', 80);
    }
    if (e.type === 'ascendStart') {
      this.add('ascension', e, C.breakthrough.duration);
      this.burst(e.x, e.y, C.realms[e.realm].color, 80, 'diamond', 240);
    }
    if (e.type === 'ascend' || e.type === 'ascendFail') {
      const color = e.type === 'ascend' ? C.realms[e.realm].color : '#eb8085';
      this.add('awakening', { ...e, color }, 2.3);
      this.burst(e.x, e.y, color, 250, 'shard', 500);
      if (own) {
        this.flash = 0.7;
        this.flashColor = color;
        this.shake = 19;
      }
    }
  }
  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 24);
    this.flash = Math.max(0, this.flash - dt * 0.8);
    this.hitstop = Math.max(0, this.hitstop - dt);
    for (const p of this.pool)
      if (p.active) {
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          this.active--;
          continue;
        }
        p.px = p.x;
        p.py = p.y;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const drag = Math.exp(-dt * 2.3);
        p.vx *= drag;
        p.vy *= drag;
        p.angle += p.spin * dt;
        if (p.kind === 'shard') p.vy += 140 * dt;
      }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      if (e.age >= e.life) {
        this.effects.splice(i, 1);
        continue;
      }
      if (e.type === 'ascension') {
        const a = this.random() * TAU,
          r = 170 * (1 - e.age / e.life) + 20;
        this.emitParticle(
          e.x + Math.cos(a) * r,
          e.y + Math.sin(a) * r,
          C.realms[e.realm].color,
          'diamond',
          160,
          0.55,
          -Math.PI / 2,
          3
        );
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      this.texts[i].age += dt;
      if (this.texts[i].age >= this.texts[i].life) this.texts.splice(i, 1);
    }
  }
  sigil(g, radius, color, t, sides = 8) {
    g.save();
    g.rotate(t);
    circle(g, 0, 0, radius, color, 1);
    circle(g, 0, 0, radius * 0.93, color, 2);
    circle(g, 0, 0, radius * 0.72, color, 1);
    for (let i = 0; i < sides; i++) {
      const a = (i * TAU) / sides,
        b = a + (TAU * 3) / sides;
      g.beginPath();
      g.moveTo(Math.cos(a) * radius * 0.72, Math.sin(a) * radius * 0.72);
      g.lineTo(Math.cos(b) * radius * 0.72, Math.sin(b) * radius * 0.72);
      g.stroke();
      g.save();
      g.rotate(a);
      g.translate(radius * 0.84, 0);
      g.fillStyle = color;
      g.font = '13px serif';
      g.textAlign = 'center';
      g.fillText('乾坤巽震坎离艮兑'[i % 8], 0, 4);
      g.restore();
    }
    g.restore();
  }
  draw(g, layer, alpha) {
    for (const e of this.effects) {
      g.save();
      g.translate(e.x, e.y);
      const f = 1 - e.age / e.life;
      if (e.type === 'skill') this.drawSkill(g, e, layer);
      else if (['ascension', 'awakening'].includes(e.type)) this.drawAscension(g, e, layer);
      else if (layer === 0 && ['ripple', 'death'].includes(e.type)) {
        g.globalAlpha = f * 0.7;
        circle(g, 0, 0, 20 + e.age * 150, e.color || '#a2c1b5', 2 * f);
        this.sigil(g, 45 + e.age * 70, e.color || '#96b6a8', e.age * 0.4, 6);
      } else if (layer === 1 && e.type === 'impact') {
        g.globalAlpha = f;
        g.rotate(e.age * 0.8);
        star(g, 0, 0, (e.critical ? 70 : 45) * f, '#fff4cb', Math.PI / 4);
        g.globalAlpha *= 0.4;
        g.drawImage(this.glow(e.color || '#eddbb2'), -70, -70, 140, 140);
      } else if (layer === 1 && e.type === 'dash') {
        g.globalAlpha = f * 0.4;
        for (let i = 0; i < 5; i++)
          blade(
            g,
            -Math.cos(e.angle) * i * 22,
            -Math.sin(e.angle) * i * 22,
            e.angle,
            55 * f,
            '#a6d6cf',
            1 - i / 6
          );
      }
      g.restore();
    }
    if (layer === 1) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const p of this.pool)
        if (p.active) {
          const f = p.life / p.maxLife,
            x = p.px + (p.x - p.px) * alpha,
            y = p.py + (p.y - p.py) * alpha;
          g.globalAlpha = Math.min(1, f * 2);
          g.strokeStyle = g.fillStyle = p.color;
          if (p.kind === 'spark') {
            g.lineWidth = Math.max(0.7, p.size * f);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x - p.vx * 0.035, y - p.vy * 0.035);
            g.stroke();
          } else if (p.kind === 'diamond') star(g, x, y, p.size * (1 + f), p.color, p.angle);
          else {
            g.save();
            g.translate(x, y);
            g.rotate(p.angle);
            g.beginPath();
            g.moveTo(-p.size * 2, 0);
            g.quadraticCurveTo(0, -p.size * 2, p.size * 2, 0);
            g.quadraticCurveTo(0, p.size, -p.size * 2, 0);
            g.fill();
            g.restore();
          }
        }
      g.restore();
    }
  }
  drawSkill(g, e, layer) {
    const sk = C.skills[e.skill],
      t = e.age,
      wind = sk.windup,
      release = Math.max(0, t - wind),
      progress = clamp(release / sk.duration, 0, 1),
      fade = Math.pow(1 - progress, 0.7),
      color = sk.color,
      r = sk.radius;
    if (t < wind) {
      const f = t / wind;
      g.globalAlpha = 0.2 + f * 0.5;
      if (layer === 0) {
        this.sigil(g, r * (0.2 + f * 0.3), color, -f, sk.count > 5 ? sk.count : 6);
        circle(g, 0, 0, r * (1 - f * 0.6), color, 1);
      } else {
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6 + f * 3;
          star(g, Math.cos(a) * r * (1 - f), Math.sin(a) * r * (1 - f), 6 * f, color, f);
        }
      }
      return;
    }
    g.globalAlpha = fade;
    g.lineCap = 'round';
    if (layer === 0) {
      g.globalAlpha *= 0.14;
      g.drawImage(this.glow(color), -r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
      g.globalAlpha = fade * 0.6;
      circle(g, 0, 0, r * Math.min(1.2, progress * 5 + 0.2), color, 1.2);
      if (!['sword', 'flame', 'dragon', 'gust', 'phantom'].includes(sk.style))
        this.sigil(
          g,
          r * (0.8 + progress * 0.2),
          color,
          release * 0.1,
          sk.style === 'prison' ? 6 : 8
        );
      return;
    }
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha *= 0.72;
    if (sk.style === 'sword') {
      g.rotate(e.angle);
      for (let i = -1; i <= 1; i++) {
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-30, i * 10);
        g.quadraticCurveTo(60, i * 35, 200 + progress * 150, i * 60);
        g.stroke();
      }
    }
    if (sk.style === 'lotus') {
      const radius = r * Math.min(1, progress * 4 + 0.15);
      g.rotate(release * 0.25);
      for (let i = 0; i < 10; i++) {
        g.save();
        g.rotate((i * TAU) / 10);
        g.fillStyle = color;
        g.globalAlpha = fade * 0.07;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(-radius * 0.48, -radius * 0.4, -radius * 0.22, -radius * 0.8, 0, -radius);
        g.bezierCurveTo(radius * 0.22, -radius * 0.8, radius * 0.48, -radius * 0.4, 0, 0);
        g.fill();
        g.globalAlpha = fade * 0.55;
        g.strokeStyle = color;
        g.lineWidth = 1.2;
        g.stroke();
        g.restore();
      }
      this.sigil(g, radius * 0.3, color, -release);
      star(g, 0, 0, radius * 0.08, '#f7ffdc');
    }
    if (sk.style === 'gust') {
      g.rotate(release * 6);
      for (let i = 0; i < 3; i++) {
        g.rotate(TAU / 3);
        const rr = r * (0.35 + progress * 0.8);
        g.strokeStyle = color;
        g.lineWidth = (1 - progress) * 9;
        g.beginPath();
        g.arc(0, 0, rr, -0.4, 1.2);
        g.stroke();
        g.lineWidth = 1;
        g.beginPath();
        g.arc(0, 0, rr + 14, -0.8, 0.7);
        g.stroke();
      }
    }
    if (sk.style === 'flame') {
      g.rotate(e.angle);
      for (let i = -1; i <= 1; i++) {
        g.strokeStyle = i === 0 ? color : sk.second;
        g.lineWidth = 8 * fade;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(70, i * 100, 150, -i * 120, 280 * progress, i * 80);
        g.stroke();
      }
    }
    if (sk.style === 'frost') {
      for (let i = 0; i < 8; i++) {
        g.save();
        g.rotate((i * TAU) / 8);
        const rr = r * (0.3 + progress * 0.7);
        g.fillStyle = color;
        g.globalAlpha = fade * 0.6;
        g.beginPath();
        g.moveTo(0, 15);
        g.lineTo(-12, -rr * 0.55);
        g.lineTo(0, -rr);
        g.lineTo(12, -rr * 0.55);
        g.closePath();
        g.fill();
        g.globalAlpha = fade;
        g.strokeStyle = '#e4ffff';
        g.lineWidth = 1.2;
        g.stroke();
        for (let j = 1; j < 4; j++) {
          g.beginPath();
          g.moveTo(-12 * j, (-rr * j) / 5 - 18);
          g.lineTo(0, (-rr * j) / 5);
          g.lineTo(12 * j, (-rr * j) / 5 - 18);
          g.stroke();
        }
        g.restore();
      }
    }
    if (sk.style === 'thunder') {
      for (let k = 0; k < 3; k++) {
        const offset = (k - 1) * 66,
          pts = [];
        for (let i = 0; i < 27; i++)
          pts.push([
            offset + Math.sin(i * 78 + k * 16 + Math.floor(release * 22)) * (i === 26 ? 0 : 23),
            -520 + i * 20,
          ]);
        for (const w of [14, 3.5, 1]) {
          g.globalAlpha = fade * (w === 14 ? 0.13 : 0.85);
          g.strokeStyle = w === 1 ? '#ffffff' : color;
          g.lineWidth = w;
          g.beginPath();
          pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
        }
        for (const i of [7, 13, 19]) {
          g.globalAlpha = fade * 0.55;
          g.lineWidth = 1;
          const [x, y] = pts[i];
          g.beginPath();
          g.moveTo(x, y);
          for (let j = 1; j < 5; j++)
            g.lineTo(x + j * 17 * (k % 2 ? 1 : -1) + Math.sin(j * 7) * 13, y + j * 17);
          g.stroke();
        }
        g.globalAlpha = fade * 0.65;
        star(g, offset, 0, 27 * fade, color);
        g.globalAlpha = fade * 0.2;
        g.drawImage(this.glow(color), offset - 65, -65, 130, 130);
      }
    }
    if (sk.style === 'solar') {
      const radius = r * (0.3 + progress * 0.7);
      for (let i = 0; i < 9; i++) {
        const a = (i * TAU) / 9 + release * 2;
        blade(
          g,
          Math.cos(a) * radius,
          Math.sin(a) * radius,
          a + Math.PI / 2,
          65 * fade + 15,
          color
        );
      }
      circle(g, 0, 0, radius, color, 5 * fade);
      star(g, 0, 0, 80 * fade, '#fff1bf', release);
    }
    if (sk.style === 'vortex') {
      for (let k = 0; k < 5; k++) {
        g.strokeStyle = k % 2 ? color : sk.second;
        g.lineWidth = (5 - k) * 1.5;
        g.beginPath();
        for (let j = 0; j < 65; j++) {
          const a = j * 0.11 + (k * TAU) / 5 - release * 4,
            rr = (j / 65) * r * (1 - progress * 0.4);
          const x = Math.cos(a) * rr,
            y = Math.sin(a) * rr * 0.7;
          j ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      const grad = g.createRadialGradient(0, 0, 3, 0, 0, 50);
      grad.addColorStop(0, '#101526');
      grad.addColorStop(0.7, '#111526e0');
      grad.addColorStop(1, '#11152600');
      g.fillStyle = grad;
      g.fillRect(-50, -50, 100, 100);
      circle(g, 0, 0, 42, color, 2);
    }
    if (sk.style === 'meteor') {
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4,
          radius = i ? r * 0.65 : 0,
          x = Math.cos(a) * radius,
          y = Math.sin(a) * radius;
        const q = Math.min(1, progress * 4 - i * 0.14);
        if (q < 0) continue;
        const off = (1 - q) * 600;
        g.strokeStyle = sk.second;
        g.lineWidth = 23 * fade;
        g.beginPath();
        g.moveTo(x - off - 120, y - off - 210);
        g.lineTo(x - off, y - off);
        g.stroke();
        g.lineWidth = 5;
        g.strokeStyle = color;
        g.stroke();
        star(g, x - off, y - off, 34 * fade, '#fff0ca');
        circle(g, x, y, 60 * progress, sk.second, 4 * fade);
      }
    }
    if (sk.style === 'phantom') {
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + e.angle,
          x = Math.cos(a) * r * (0.8 - progress),
          y = Math.sin(a) * r * (0.8 - progress);
        g.save();
        g.translate(x, y);
        g.rotate(a + Math.PI);
        blade(g, 0, 0, 0, 160, color);
        g.strokeStyle = sk.second;
        g.lineWidth = 14 * fade;
        g.globalAlpha = fade * 0.25;
        g.beginPath();
        g.moveTo(-120, 0);
        g.lineTo(100, 0);
        g.stroke();
        g.restore();
      }
    }
    if (['nova', 'galaxy'].includes(sk.style)) {
      g.strokeStyle = sk.second;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < sk.count; i++) {
        const a = i * 2.399 + release * 0.12,
          rr = r * Math.sqrt((i + 1) / sk.count),
          x = Math.cos(a) * rr,
          y = Math.sin(a) * rr * 0.7;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      for (let i = 0; i < sk.count; i++) {
        const a = i * 2.399 + release * 0.12,
          rr = r * Math.sqrt((i + 1) / sk.count),
          x = Math.cos(a) * rr,
          y = Math.sin(a) * rr * 0.7;
        const pulse = 0.3 + 0.7 * Math.abs(Math.sin(release * 5 - i));
        star(g, x, y, (sk.style === 'nova' ? 29 : 20) * pulse, color, release * 0.3);
        g.globalAlpha = fade * 0.2;
        g.drawImage(this.glow(color), x - 50, y - 50, 100, 100);
        g.globalAlpha = fade;
        if (sk.style === 'galaxy') {
          g.strokeStyle = color;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(x - 80 * fade, y - 300 * fade);
          g.lineTo(x, y);
          g.stroke();
        }
      }
    }
    if (sk.style === 'prison') {
      g.rotate(release * 0.1);
      const radius = r * (0.8 + 0.2 * Math.sin(progress * Math.PI));
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6,
          b = ((i + 2) * TAU) / 6;
        const x = Math.cos(a) * radius,
          y = Math.sin(a) * radius;
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(
          Math.sin(release * 4) * 50,
          -100 * fade,
          Math.cos(b) * radius,
          Math.sin(b) * radius
        );
        g.stroke();
        g.fillStyle = color;
        g.globalAlpha = fade * 0.3;
        g.fillRect(x - 9, y - 52, 18, 52);
        g.globalAlpha = fade;
        g.font = '21px serif';
        g.fillText('敕', x - 10, y - 20);
        star(g, x, y, 13, color);
      }
    }
    if (sk.style === 'dragon') {
      g.rotate(e.angle);
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = k ? color : sk.second;
        g.lineWidth = k ? 2 : 14;
        g.globalAlpha = fade * (k ? 0.8 : 0.3);
        g.beginPath();
        for (let i = 0; i < 50; i++) {
          const x = i * 7,
            y = Math.sin(i * 0.15 - release * 10) * (20 + k * 5);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
    }
    if (sk.style === 'judgment') {
      const beam = g.createLinearGradient(0, -900, 0, 60);
      beam.addColorStop(0, '#fff8d900');
      beam.addColorStop(0.65, '#fff0ba44');
      beam.addColorStop(1, '#fff8d9aa');
      g.fillStyle = beam;
      g.fillRect(-70 * fade, -900, 140 * fade, 940);
      g.strokeStyle = color;
      g.lineWidth = 1.4;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(i * 35, -800);
        g.lineTo(i * 35 * (1 + progress), 0);
        g.stroke();
      }
      g.save();
      g.scale(1, 0.35);
      this.sigil(g, r * 0.8, color, release * 0.35);
      this.sigil(g, r * 0.6, color, -release * 0.2);
      g.restore();
      g.globalAlpha = fade * 0.25;
      g.drawImage(this.glow(color), -240, -240, 480, 480);
      g.globalAlpha = fade * 0.75;
      star(g, 0, 0, 65 * fade, '#fff7d1');
      for (let i = 0; i < 12; i++) {
        const a = (i * TAU) / 12 + release * 0.4;
        star(g, Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.25, 6 + 5 * fade, color, a);
      }
    }
  }
  drawAscension(g, e, layer) {
    const p = e.age / e.life,
      color = e.color || C.realms[e.realm].color;
    g.globalAlpha = e.type === 'awakening' ? 1 - p : 0.25 + p * 0.75;
    if (layer === 0) {
      const r = e.type === 'awakening' ? 80 + p * 650 : 100 + Math.sin(p * Math.PI) * 95;
      this.sigil(g, r, color, p * 3);
      this.sigil(g, r * 0.7, color, -p * 2);
      circle(g, 0, 0, r * 1.15, color, 2);
    } else {
      g.globalCompositeOperation = 'lighter';
      const w = e.type === 'awakening' ? 100 * (1 - p) : 15 + p * p * 65;
      const grad = g.createLinearGradient(0, -1000, 0, 30);
      grad.addColorStop(0, color + '00');
      grad.addColorStop(0.6, color + '60');
      grad.addColorStop(1, color + 'c0');
      g.fillStyle = grad;
      g.fillRect(-w, -1000, w * 2, 1030);
      g.strokeStyle = color;
      g.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const a = (i * TAU) / 5 + p * 7;
        g.beginPath();
        g.ellipse(0, -p * 200, 130 + Math.sin(a) * 25, 35, a * 0.1, 0, TAU);
        g.stroke();
      }
    }
  }
  drawTexts(g) {
    g.save();
    g.textAlign = 'center';
    for (const t of this.texts) {
      const f = t.age / t.life;
      g.globalAlpha = Math.min(1, (1 - f) * 3);
      g.font = `${t.big ? 'bold 27' : '17'}px Georgia, "Microsoft YaHei", serif`;
      g.lineWidth = 3;
      g.strokeStyle = '#152727';
      g.fillStyle = t.color;
      const x = t.x + t.drift * f,
        y = t.y - 45 * f - Math.sin(Math.min(1, f * 3) * Math.PI) * 10;
      g.strokeText(t.text, x, y);
      g.fillText(t.text, x, y);
    }
    g.restore();
  }
  clear() {
    for (const p of this.pool) p.active = false;
    this.active = 0;
    this.effects.length = 0;
    this.texts.length = 0;
    this.shake = this.flash = 0;
  }
}
