import { CONFIG as C } from './config.js';
import { rng, clamp, lerp } from './math.js';
import { stats } from './simulation.js';
import { Effects, circle, star, blade } from './effects.js';
const TAU = Math.PI * 2;
function path(g, points, fill, stroke, width = 1) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.stroke();
  }
}
function ellipse(g, x, y, rx, ry, color) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.fill();
}
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    if (!this.g) throw new Error('当前浏览器无法建立 Canvas 2D 画布');
    this.fx = new Effects();
    this.terrain = new Map();
    this.camera = { x: 1050, y: 790, px: 1050, py: 790 };
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.scale = 1;
    this.time = 0;
    this.zone = 0;
    this.fps = 60;
    this.frameCost = 0;
    this.frames = 0;
    this.sample = 0;
    this.sampleStart = performance.now();
    this.qualitySetting = 'auto';
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
  }
  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(C.limits.dpr, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.scale = Math.max(0.5, Math.min(this.width / 1490, this.height / 900));
  }
  update(dt, player, title = false) {
    this.time += dt;
    this.camera.px = this.camera.x;
    this.camera.py = this.camera.y;
    const tx = title ? 1170 + Math.sin(this.time * 0.08) * 35 : (player?.x ?? 1050),
      ty = title ? 770 : (player?.y ?? 850) - 20;
    const smooth = 1 - Math.exp(-dt * 7);
    this.camera.x = lerp(this.camera.x, tx, smooth);
    this.camera.y = lerp(this.camera.y, ty, smooth);
    this.fx.update(dt);
    if (this.fx.hitstop <= 0) this.poseTime = this.time;
  }
  screenToWorld(x, y) {
    return {
      x: (x - this.width / 2) / this.scale + this.camera.x,
      y: (y - this.height / 2) / this.scale + this.camera.y,
    };
  }
  buildTerrain(zone) {
    if (this.terrain.has(zone)) return this.terrain.get(zone);
    const canvas = document.createElement('canvas'),
      resolution = 1.5;
    canvas.width = C.world.width * resolution;
    canvas.height = C.world.height * resolution;
    const g = canvas.getContext('2d');
    g.scale(resolution, resolution);
    const z = C.zones[zone],
      random = rng(C.world.seed + zone * 113),
      W = C.world.width,
      H = C.world.height;
    const ground = g.createRadialGradient(1100, 850, 40, 1100, 850, 1500);
    ground.addColorStop(0, z.light);
    ground.addColorStop(0.6, z.ground);
    ground.addColorStop(1, z.dark);
    g.fillStyle = ground;
    g.fillRect(0, 0, W, H);
    // Broad terrain strata, mineral seams and moss flecks are cached, never repainted per frame.
    for (let i = 0; i < 180; i++) {
      const x = random() * W,
        y = random() * H,
        r = 20 + random() * 150;
      g.globalAlpha = 0.025 + random() * 0.035;
      const shade = g.createRadialGradient(x, y, 0, x, y, r);
      shade.addColorStop(0, i % 2 ? '#d4d8ad' : '#001e26');
      shade.addColorStop(1, i % 2 ? '#d4d8ad00' : '#001e2600');
      g.fillStyle = shade;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    // A wandering river, with stone shelf banks and hand-drawn contour lines.
    for (const [width, color] of [
      [330, z.dark],
      [302, zone === 1 ? '#45312c' : '#30524b'],
      [270, z.water],
    ]) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(120, -100);
      g.bezierCurveTo(400, 280, 130, 610, 400, 870);
      g.bezierCurveTo(540, 1120, 280, 1370, 620, 1700);
      g.stroke();
    }
    for (let i = 0; i < 95; i++) {
      const y = random() * H,
        x = 120 + random() * 230 + Math.sin(y / 300) * 70;
      g.strokeStyle = zone === 1 ? '#f9b07725' : '#a7ddd325';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + 20, y - 4, x + 55, y + 5, x + 85, y);
      g.stroke();
    }
    // Worn paths lead from the sanctuary to the three ancient stele sites.
    const trails = [
      [
        [1050, 1600],
        [995, 1190],
        [1070, 950],
        [1050, 850],
      ],
      [
        [1050, 850],
        [1300, 720],
        [1500, 650],
        [1690, 410],
      ],
      [
        [1050, 850],
        [850, 720],
        [650, 590],
        [520, 470],
      ],
      [
        [1050, 850],
        [1240, 970],
        [1500, 1100],
        [1750, 1050],
      ],
    ];
    for (const points of trails) {
      g.strokeStyle = zone === 0 ? '#75847222' : '#ac9c8922';
      g.lineWidth = 120;
      g.beginPath();
      g.moveTo(...points[0]);
      g.bezierCurveTo(...points[1], ...points[2], ...points[3]);
      g.stroke();
    }
    for (const points of trails)
      for (let i = 0; i < 110; i++) {
        const t = i / 109,
          q = 1 - t,
          x =
            q ** 3 * points[0][0] +
            3 * q * q * t * points[1][0] +
            3 * q * t * t * points[2][0] +
            t ** 3 * points[3][0] +
            (random() - 0.5) * 80,
          y =
            q ** 3 * points[0][1] +
            3 * q * q * t * points[1][1] +
            3 * q * t * t * points[2][1] +
            t ** 3 * points[3][1] +
            (random() - 0.5) * 50,
          s = 6 + random() * 18;
        path(
          g,
          [
            [x - s, y],
            [x - s * 0.8, y - s * 0.38],
            [x + s * 0.4, y - s * 0.6],
            [x + s, y - s * 0.13],
            [x + s * 0.8, y + s * 0.35],
            [x - s * 0.3, y + s * 0.4],
          ],
          zone === 1 ? '#83726133' : '#9baa8b29',
          '#101e252a',
          0.8
        );
        g.strokeStyle = '#c7cbae20';
        g.beginPath();
        g.moveTo(x - s * 0.8, y - s * 0.38);
        g.lineTo(x + s * 0.4, y - s * 0.6);
        g.stroke();
      }
    for (let i = 0; i < 150; i++) {
      const x = 620 + random() * 1400,
        y = 100 + random() * 1400,
        s = 9 + random() * 26;
      g.globalAlpha = 0.16;
      path(
        g,
        [
          [x - s, y],
          [x, y - s * 0.4],
          [x + s * 1.6, y],
          [x + s, y + s * 0.35],
        ],
        '#a2b0a0',
        '#142e2b'
      );
    }
    g.globalAlpha = 1;
    // Fine grass and mineral grasslets break up the ground without adding runtime draw cost.
    for (let i = 0; i < 4300; i++) {
      const x = 490 + random() * (W - 500),
        y = random() * H;
      if (Math.hypot(x - 1050, y - 850) < 230) continue;
      const h = 3 + random() * 11;
      g.strokeStyle =
        zone === 0 ? (i % 3 ? '#70906630' : '#a9b78935') : zone === 1 ? '#a88c6b25' : '#a1a3c429';
      g.lineWidth = 0.65;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.quadraticCurveTo(x - 2, y - h * 0.4, x - 8, y - h);
      g.moveTo(x, y);
      g.quadraticCurveTo(x, y - h * 0.7, x + 2, y - h * 1.3);
      g.moveTo(x + 3, y);
      g.lineTo(x + 8, y - h * 0.7);
      g.stroke();
    }
    // Sanctuary terraces and a visibly bounded safe cultivation circle.
    for (let i = 5; i >= 0; i--) {
      ellipse(g, 1050, 860 + i * 8, 194 + i * 8, 144 + i * 7, i % 2 ? '#1e3835' : '#627469');
    }
    const stone = g.createRadialGradient(1050, 850, 20, 1050, 850, 215);
    stone.addColorStop(0, '#657a69');
    stone.addColorStop(0.8, '#40564c');
    stone.addColorStop(1, '#2b4842');
    ellipse(g, 1050, 850, 194, 147, stone);
    g.save();
    g.translate(1050, 850);
    g.scale(1, 0.76);
    this.fx.sigil(g, 169, '#c6cfa04a', 0.3);
    this.fx.sigil(g, 134, '#d6dbad35', -0.3);
    g.restore();
    for (let i = 0; i < 6; i++) {
      const y = 996 + i * 12;
      path(
        g,
        [
          [993 - i * 6, y],
          [1106 + i * 6, y],
          [1110 + i * 6, y + 9],
          [990 - i * 6, y + 9],
        ],
        i % 2 ? '#64796a' : '#4b6255',
        '#b9c6a533'
      );
    }
    // Small stone bridge over the jade stream.
    g.save();
    g.translate(350, 790);
    g.rotate(0.2);
    path(
      g,
      [
        [-195, -45],
        [195, -45],
        [195, 65],
        [-195, 65],
      ],
      '#66766a',
      '#a7b09b'
    );
    for (let i = -190; i < 190; i += 26) {
      g.strokeStyle = '#243e38';
      g.beginPath();
      g.moveTo(i, -45);
      g.lineTo(i, 65);
      g.stroke();
    }
    for (const y of [-48, 62]) {
      g.fillStyle = '#344c44';
      g.fillRect(-190, y, 380, 9);
      for (let x = -180; x <= 180; x += 60) {
        g.fillStyle = '#718173';
        g.fillRect(x, y - 26, 10, 28);
        ellipse(g, x + 5, y - 26, 9, 4, '#b9c1a9');
      }
    }
    g.restore();
    const props = [];
    for (let i = 0; i < 108; i++) {
      const x = 60 + random() * (W - 120),
        y = 40 + random() * (H - 80);
      if (
        Math.hypot(x - 1050, y - 850) < 285 ||
        C.exploration.shrines.some((s) => Math.hypot(x - s.x, y - s.y) < 90)
      )
        continue;
      props.push({ x, y, s: 0.6 + random() * 0.9, kind: random() });
    }
    props.sort((a, b) => a.y - b.y);
    for (const o of props) {
      if (o.x < 500 && o.y > 250 && o.y < 1450) continue;
      if (zone === 0 && o.kind > 0.28) this.bamboo(g, o.x, o.y, o.s, random);
      else if (zone === 2 && o.kind > 0.6) this.crystal(g, o.x, o.y, o.s);
      else this.rock(g, o.x, o.y, o.s, zone, random);
    }
    this.gate(g, 1005, 640, zone);
    this.lantern(g, 851, 880, zone);
    this.lantern(g, 1249, 880, zone);
    if (zone < 2) {
      this.maple(g, 1310, 696, 1.2, zone, random);
      this.maple(g, 715, 1090, 1, zone, random);
      this.maple(g, 1870, 700, 1.45, zone, random);
    }
    for (let i = 0; i < C.exploration.shrines.length; i++) {
      const s = C.exploration.shrines[i];
      this.stele(g, s.x, s.y, zone, i);
    }
    // The boss's arena carries a large, weathered binding seal.
    g.save();
    g.translate(1670, 410);
    g.scale(1, 0.75);
    g.globalAlpha = 0.34;
    this.fx.sigil(g, 150, z.color, 0.2);
    g.restore();
    for (let i = 0; i < 3000; i++) {
      const x = random() * W,
        y = random() * H;
      g.fillStyle = random() > 0.5 ? '#c4d7ac0d' : '#061e230b';
      g.fillRect(x, y, 1 + random() * 3, 1);
    }
    const grain = document.createElement('canvas');
    grain.width = 550;
    grain.height = 400;
    const ng = grain.getContext('2d'),
      pixels = ng.createImageData(550, 400);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const v = Math.floor(random() * 200 + 20);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
      pixels.data[i + 3] = 25;
    }
    ng.putImageData(pixels, 0, 0);
    g.globalCompositeOperation = 'soft-light';
    g.drawImage(grain, 0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    this.terrain.set(zone, canvas);
    return canvas;
  }
  maple(g, x, y, s, zone, random) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    ellipse(g, 25, 9, 108, 28, '#051b2450');
    const bark = g.createLinearGradient(-15, 0, 20, 0);
    bark.addColorStop(0, '#263a36');
    bark.addColorStop(0.5, '#5c6050');
    bark.addColorStop(1, '#263b38');
    path(
      g,
      [
        [-17, 5],
        [-5, -28],
        [1, -70],
        [-16, -119],
        [-3, -111],
        [12, -71],
        [34, -105],
        [58, -124],
        [43, -97],
        [19, -58],
        [17, -20],
        [30, 6],
        [7, -4],
      ],
      bark,
      '#a8a88b33'
    );
    g.strokeStyle = '#424c40';
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(3, -70);
    g.bezierCurveTo(-36, -95, -42, -113, -75, -129);
    g.moveTo(9, -83);
    g.lineTo(20, -155);
    g.stroke();
    const clusters = [
      [-68, -132, 44],
      [-35, -149, 48],
      [8, -159, 52],
      [52, -143, 48],
      [82, -120, 34],
      [-85, -111, 27],
      [25, -119, 49],
    ];
    for (const [cx, cy, radius] of clusters) {
      const pts = [];
      for (let i = 0; i < 17; i++) {
        const a = (i * TAU) / 17,
          r = radius * (0.65 + random() * 0.35);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.55]);
      }
      path(g, pts, zone === 0 ? '#844d3e' : '#694135', '#be795239');
      for (let i = 0; i < 90; i++) {
        const a = random() * TAU,
          r = Math.sqrt(random()) * radius,
          lx = cx + Math.cos(a) * r,
          ly = cy + Math.sin(a) * r * 0.5,
          size = 2 + random() * 5;
        g.fillStyle = ['#b26f4e', '#ba7950', '#8e473a', '#c18e5c', '#9a5e42'][i % 5];
        path(
          g,
          [
            [lx, ly - size],
            [lx + size * 0.3, ly - size * 0.2],
            [lx + size, ly - size * 0.45],
            [lx + size * 0.6, ly + size * 0.2],
            [lx - size * 0.6, ly + size * 0.4],
            [lx - size, ly - size * 0.4],
            [lx - size * 0.3, ly - size * 0.2],
          ],
          g.fillStyle
        );
      }
    }
    for (let i = 0; i < 60; i++) {
      const px = (random() - 0.5) * 180,
        py = random() * 44 - 7;
      path(
        g,
        [
          [px, py - 2],
          [px + 3, py],
          [px + 1, py + 2],
          [px - 4, py + 1],
        ],
        '#bc82544a'
      );
    }
    g.restore();
  }
  bamboo(g, x, y, s, random) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    ellipse(g, 0, 5, 65, 14, '#071f2338');
    for (let j = 0; j < 5; j++) {
      const h = 105 + random() * 100,
        xx = (j - 2) * 13,
        lean = (random() - 0.5) * 40;
      g.strokeStyle = j % 2 ? '#54836b' : '#285b4d';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(xx, 0);
      g.lineTo(xx + lean, -h);
      g.stroke();
      g.strokeStyle = '#afd0a477';
      g.lineWidth = 1;
      for (let k = 20; k < h; k += 26) {
        const sx = xx + (lean * k) / h;
        g.beginPath();
        g.moveTo(sx - 3, -k);
        g.lineTo(sx + 3, -k);
        g.stroke();
      }
      for (let k = 0; k < 8; k++) {
        const yy = -h + k * 12,
          sx = xx + lean * (1 - (k * 12) / h),
          sign = k % 2 ? 1 : -1;
        g.strokeStyle = '#497c62';
        g.beginPath();
        g.moveTo(sx, yy + 20);
        g.lineTo(sx + 50 * sign, yy);
        g.stroke();
        for (let n = 1; n < 5; n++) {
          const lx = sx + n * 10 * sign,
            ly = yy + 18 - n * 4;
          path(
            g,
            [
              [lx, ly],
              [lx + sign * 22, ly - 19],
              [lx + sign * 13, ly - 4],
            ],
            k % 2 ? '#59816b' : '#345f50'
          );
          path(
            g,
            [
              [lx, ly],
              [lx + sign * 27, ly + 6],
              [lx + sign * 11, ly + 7],
            ],
            '#2c5849'
          );
        }
      }
    }
    g.restore();
  }
  rock(g, x, y, s, zone, random) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    ellipse(g, 5, 5, 43, 15, '#07161d66');
    path(
      g,
      [
        [-43, 0],
        [-34, -31],
        [-6, -54],
        [29, -41],
        [46, -8],
        [27, 12],
        [-19, 15],
      ],
      zone === 1 ? '#6a5144' : '#54665c',
      '#182d2c'
    );
    path(
      g,
      [
        [-34, -31],
        [-6, -54],
        [29, -41],
        [10, -18],
        [-7, -14],
      ],
      zone === 1 ? '#8a6851' : '#718071'
    );
    path(
      g,
      [
        [10, -18],
        [29, -41],
        [46, -8],
        [27, 12],
        [7, 6],
      ],
      zone === 1 ? '#45392f' : '#354b46'
    );
    g.strokeStyle = zone === 1 ? '#f5a36f77' : '#aebaa044';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-25, -31);
    g.lineTo(4, -18);
    g.lineTo(-2, 2);
    g.stroke();
    if (random() > 0.5) ellipse(g, -15, -18, 18, 5, zone === 1 ? '#825133' : '#557b52');
    g.restore();
  }
  crystal(g, x, y, s) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    ellipse(g, 0, 0, 45, 16, '#a595dd16');
    for (let i = -1; i <= 1; i++) {
      g.save();
      g.translate(i * 20, 0);
      g.rotate(i * 0.25);
      path(
        g,
        [
          [-13, -5],
          [-11, -65],
          [0, -91 - (i === 0 ? 30 : 0)],
          [14, -63],
          [12, -3],
          [0, 6],
        ],
        '#7e83a7',
        '#c1b7e9aa'
      );
      path(
        g,
        [
          [0, -91 - (i === 0 ? 30 : 0)],
          [14, -63],
          [12, -3],
          [0, 6],
        ],
        '#4b5578'
      );
      g.restore();
    }
    g.restore();
  }
  lantern(g, x, y, zone) {
    g.save();
    g.translate(x, y);
    ellipse(g, 0, 6, 28, 11, '#0a202466');
    path(
      g,
      [
        [-20, 0],
        [-12, -9],
        [12, -9],
        [20, 0],
        [20, 5],
        [-20, 5],
      ],
      '#728074'
    );
    g.fillStyle = '#41574e';
    g.fillRect(-5, -54, 10, 49);
    g.fillStyle = '#cbd094';
    g.fillRect(-12, -71, 24, 20);
    g.strokeStyle = '#3d554b';
    g.lineWidth = 4;
    g.strokeRect(-14, -73, 28, 24);
    path(
      g,
      [
        [-24, -72],
        [-11, -81],
        [0, -91],
        [11, -81],
        [24, -72],
      ],
      '#314f49',
      '#8ca28b'
    );
    g.globalAlpha = 0.3;
    g.drawImage(this.fx.glow(zone === 1 ? '#f9a37e' : '#f2d98d'), -66, -121, 132, 132);
    g.restore();
  }
  gate(g, x, y, zone) {
    g.save();
    g.translate(x, y);
    const wall = zone === 1 ? '#814a3d' : '#6d6650';
    ellipse(g, 40, 25, 140, 30, '#0c24273d');
    for (const xx of [-75, 75]) {
      path(
        g,
        [
          [xx - 15, 18],
          [xx + 18, 18],
          [xx + 13, 8],
          [xx - 12, 8],
        ],
        '#708277'
      );
      g.fillStyle = wall;
      g.fillRect(xx - 8, -133, 16, 145);
      g.fillStyle = '#a5a187';
      g.fillRect(xx - 9, -113, 3, 109);
    }
    g.fillStyle = wall;
    g.fillRect(-94, -120, 188, 15);
    path(
      g,
      [
        [-132, -151],
        [-112, -142],
        [-50, -151],
        [0, -176],
        [48, -151],
        [112, -142],
        [132, -151],
        [117, -127],
        [0, -139],
        [-117, -127],
      ],
      '#1e3f3a',
      '#99ac91'
    );
    path(
      g,
      [
        [-119, -126],
        [0, -138],
        [119, -126],
        [114, -119],
        [0, -130],
        [-114, -119],
      ],
      '#304f45'
    );
    for (let i = -110; i <= 110; i += 8) {
      const height = 22 - Math.abs(i) * 0.11;
      g.strokeStyle = '#82938558';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(i, -137 - height);
      g.quadraticCurveTo(
        i + 3,
        -134 - height * 0.5,
        i + 3,
        -129 - Math.max(0, 10 - Math.abs(i) * 0.08)
      );
      g.stroke();
    }
    g.strokeStyle = '#b7b28a80';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-128, -150);
    g.quadraticCurveTo(-115, -138, -60, -149);
    g.lineTo(0, -176);
    g.lineTo(60, -149);
    g.quadraticCurveTo(115, -138, 128, -150);
    g.stroke();
    for (const side of [-1, 1]) {
      g.save();
      g.translate(side * 91, -110);
      path(
        g,
        [
          [-9, 0],
          [8, 0],
          [8, 66],
          [0, 58],
          [-9, 68],
        ],
        '#9a5641',
        '#cc9265',
        0.7
      );
      g.fillStyle = '#d8b17b';
      g.font = '10px "KaiTi",serif';
      g.textAlign = 'center';
      for (let i = 0; i < 3; i++)
        g.fillText((side === -1 ? '云海阔' : '道心长')[i], 0, 19 + i * 15);
      g.restore();
    }
    g.fillStyle = '#203c38';
    g.fillRect(-34, -127, 68, 34);
    g.strokeStyle = '#a7ac7c';
    g.strokeRect(-34, -127, 68, 34);
    g.fillStyle = '#e0d5a7';
    g.font = '17px "KaiTi",serif';
    g.textAlign = 'center';
    g.fillText('问 道', 0, -105);
    g.restore();
  }
  stele(g, x, y, zone, index) {
    g.save();
    g.translate(x, y);
    ellipse(g, 0, 5, 60, 23, '#0b202a55');
    g.save();
    g.scale(1, 0.55);
    this.fx.sigil(g, 55, '#d9ca8866', index);
    g.restore();
    path(
      g,
      [
        [-24, 0],
        [-22, -75],
        [-13, -91],
        [17, -86],
        [25, -66],
        [23, 0],
      ],
      '#4e625b',
      '#94a08a'
    );
    path(
      g,
      [
        [17, -86],
        [25, -66],
        [23, 0],
        [13, 0],
      ],
      '#2d4743'
    );
    g.fillStyle = '#e9d397';
    g.textAlign = 'center';
    g.font = '18px "KaiTi",serif';
    g.fillText(['道', '心', '玄'][index], 0, -58);
    g.fillText(['法', '印', '机'][index], 0, -34);
    g.restore();
  }
  draw(world, localId, alpha, title = false) {
    const began = performance.now(),
      g = this.g,
      p = world.players.get(localId),
      zone = p?.zone ?? 0,
      z = C.zones[zone];
    this.zone = zone;
    this.fx.zone = zone;
    this.fx.localId = localId;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = z.dark;
    g.fillRect(0, 0, this.width, this.height);
    const camX = lerp(this.camera.px, this.camera.x, alpha),
      camY = lerp(this.camera.py, this.camera.y, alpha),
      shake = this.reduced ? 0 : this.fx.shake;
    g.save();
    g.translate(
      this.width / 2 + Math.sin(this.time * 93) * shake,
      this.height / 2 + Math.cos(this.time * 117) * shake * 0.6
    );
    g.scale(this.scale, this.scale);
    g.translate(-camX, -camY);
    g.drawImage(this.buildTerrain(zone), 0, 0, C.world.width, C.world.height);
    this.drawAtmosphere(g, z, 0);
    // A calm animated seal marks the sanctuary. This is aesthetic time only.
    g.save();
    g.translate(1050, 850);
    g.scale(1, 0.76);
    g.globalAlpha = 0.16 + Math.sin(this.time * 0.5) * 0.04;
    this.fx.sigil(g, 151, '#dce2b1', this.time * 0.025);
    g.restore();
    for (let i = 0; i < C.exploration.shrines.length; i++) {
      const s = C.exploration.shrines[i],
        done = p && p.explored & (1 << (zone * 3 + i));
      if (!done) {
        g.globalAlpha = 0.35;
        g.drawImage(this.fx.glow('#e7d197'), s.x - 48, s.y - 110, 96, 96);
        g.globalAlpha = 1;
        star(g, s.x, s.y - 111 + Math.sin(this.time * 2 + i) * 5, 7, '#e7d197', this.time * 0.3);
      }
    }
    for (const l of world.loot)
      if (l.zone === zone) {
        const t = this.time * 2 + l.id,
          y = l.y - 6 + Math.sin(t) * 4;
        g.globalAlpha = 0.28;
        g.drawImage(this.fx.glow('#efd58d'), l.x - 32, y - 32, 64, 64);
        g.globalAlpha = 1;
        path(
          g,
          [
            [l.x, y - 9],
            [l.x + 6, y],
            [l.x, y + 8],
            [l.x - 6, y],
          ],
          '#f0dca1',
          '#fff3ca'
        );
      }
    for (const m of world.monsters)
      if (m.zone === zone && m.hp > 0 && m.state === 'windup') {
        g.save();
        g.translate(m.x, m.y);
        g.rotate(m.angle);
        g.globalAlpha = 0.3;
        path(
          g,
          [
            [0, -25],
            [320, -55],
            [360, 0],
            [320, 55],
            [0, 25],
          ],
          '#e78d65',
          '#ffc591',
          2
        );
        g.restore();
      }
    this.fx.draw(g, 0, alpha);
    const actors = [
      ...world.monsters.filter((m) => m.zone === zone && m.hp > 0).map((m) => ({ m, y: m.y })),
      ...[...world.players.values()].filter((a) => a.zone === zone).map((a) => ({ p: a, y: a.y })),
    ].sort((a, b) => a.y - b.y);
    for (const actor of actors)
      actor.p
        ? this.drawPlayer(g, actor.p, actor.p.id === localId, alpha, title)
        : this.drawMonster(g, actor.m, zone, alpha);
    for (const q of world.projectiles) if (q.zone === zone) this.drawProjectile(g, q, alpha);
    this.fx.draw(g, 1, alpha);
    this.drawAtmosphere(g, z, 1);
    this.fx.drawTexts(g);
    if (!title) {
      g.textAlign = 'center';
      g.font = '12px "Microsoft YaHei",sans-serif';
      g.fillStyle = '#d2dcc399';
      g.fillText('问 道 台 · 安 全 区', 1050, 1061);
    }
    g.restore();
    const vignette = g.createRadialGradient(
      this.width * 0.5,
      this.height * 0.45,
      this.height * 0.2,
      this.width * 0.5,
      this.height * 0.5,
      this.width * 0.68
    );
    vignette.addColorStop(0, '#07182000');
    vignette.addColorStop(1, '#06141ec0');
    g.fillStyle = vignette;
    g.fillRect(0, 0, this.width, this.height);
    if (this.fx.flash > 0) {
      g.globalAlpha = this.reduced ? this.fx.flash * 0.2 : this.fx.flash;
      g.fillStyle = this.fx.flashColor;
      g.fillRect(0, 0, this.width, this.height);
      g.globalAlpha = 1;
    }
    this.frameCost = lerp(this.frameCost, performance.now() - began, 0.03);
    this.frames++;
    this.sample++;
    const now = performance.now();
    if (now - this.sampleStart >= 1000) {
      this.fps = (this.sample * 1000) / (now - this.sampleStart);
      this.sample = 0;
      this.sampleStart = now;
      if (this.qualitySetting === 'auto') {
        if (this.frameCost > 10 || this.fps < 48)
          this.fx.quality = Math.max(C.limits.minQuality, this.fx.quality - 0.15);
        else if (this.frameCost < 5 && this.fps >= 55)
          this.fx.quality = Math.min(1, this.fx.quality + 0.05);
      }
    }
  }
  drawPlayer(g, p, local, alpha, title) {
    const x = lerp(p.px, p.x, alpha),
      y = lerp(p.py, p.y, alpha),
      color = C.realms[p.realm].color,
      t = this.poseTime || 0,
      moving = Math.hypot(p.x - p.px, p.y - p.py) > 0.05,
      bob = moving ? Math.sin(t * 16) * 2 : Math.sin(t * 2) * 0.8;
    g.save();
    g.translate(x, y);
    if (p.down) {
      g.rotate(-Math.PI / 2);
      g.globalAlpha = 0.5;
    }
    ellipse(g, 0, 4, 25, 10, '#07151e80');
    if (local) {
      g.save();
      g.scale(1, 0.55);
      circle(g, 0, 5, 30, color + '80', 1);
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 5, 31, p.angle - 0.3, p.angle + 0.3);
      g.stroke();
      g.restore();
    }
    if (p.dash > 0) {
      g.save();
      g.globalAlpha = 0.2;
      for (let i = 1; i < 4; i++) {
        const xx = -p.dashX * i * 23,
          yy = -p.dashY * i * 23;
        path(
          g,
          [
            [xx - 7, yy - 42],
            [xx + 7, yy - 42],
            [xx + 18, yy + 1],
            [xx - 18, yy + 1],
          ],
          color
        );
      }
      g.restore();
    }
    if (p.practice) {
      g.save();
      g.globalAlpha = 0.45;
      g.scale(1, 0.6);
      this.fx.sigil(g, 64 + Math.sin(t * 2) * 3, color, -t * 0.25);
      g.restore();
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + t * 0.8;
        star(g, Math.cos(a) * 40, Math.sin(a) * 20 - 25, 3, color);
      }
    }
    if (p.realm > 0) {
      g.save();
      g.globalAlpha = 0.5;
      for (let i = 0; i < p.realm + 1; i++) {
        const a = t * 0.9 + (i * TAU) / (p.realm + 1);
        blade(g, Math.cos(a) * 42, Math.sin(a) * 23 - 18, a + Math.PI / 2, 15, color);
      }
      g.restore();
    }
    g.translate(0, bob);
    const facing = Math.cos(p.angle) >= 0 ? 1 : -1;
    g.scale(facing, 1);
    // Multiple robe silhouettes, sash and hair ribbons give the cultivator a readable wuxia outline.
    path(
      g,
      [
        [-7, -36],
        [-19, -12],
        [-25 - Math.sin(t * 4) * 5, 9],
        [-8, 3],
        [2, -14],
      ],
      '#172b36',
      '#6d9690'
    );
    path(
      g,
      [
        [8, -35],
        [22, -9],
        [27 + Math.sin(t * 3) * 4, 7],
        [11, 2],
        [-1, -15],
      ],
      '#2b4850',
      '#72968e'
    );
    path(
      g,
      [
        [-10, -32],
        [11, -31],
        [13, -17],
        [21, 5],
        [4, 2],
        [-1, 7],
        [-19, 4],
        [-10, -17],
      ],
      p.hurt > 0 ? '#ffe2cf' : '#e2e0c8',
      '#b3c9b8',
      0.7
    );
    path(
      g,
      [
        [-7, -32],
        [0, -19],
        [10, -32],
        [5, -13],
        [-4, -13],
      ],
      '#5f8f88'
    );
    g.strokeStyle = '#8a9d8c';
    g.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(-4 + i * 4, -11);
      g.lineTo(-9 + i * 8, 2);
      g.stroke();
    }
    path(
      g,
      [
        [-11, -15],
        [11, -15],
        [11, -11],
        [-10, -11],
      ],
      '#92554b'
    );
    g.strokeStyle = '#c08964';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-6, -12);
    g.bezierCurveTo(-20, -8, -19, 3, -30, 1 + Math.sin(t * 5) * 5);
    g.stroke();
    g.strokeStyle = '#d0bd7e';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-10, -14);
    g.lineTo(12, -14);
    g.stroke();
    g.strokeStyle = '#a8c8bc';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(9, -16);
    g.bezierCurveTo(28, -8, 39, -25 + Math.sin(t * 4) * 8, 58, -15);
    g.stroke();
    g.strokeStyle = '#c7b678';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = '#deceb0';
    g.beginPath();
    g.ellipse(0, -41, 7, 9, -0.1, 0, TAU);
    g.fill();
    path(
      g,
      [
        [-7, -41],
        [-8, -49],
        [0, -53],
        [7, -48],
        [7, -42],
        [1, -46],
      ],
      '#132733'
    );
    g.strokeStyle = '#162b36';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(-5, -46);
    g.bezierCurveTo(-15, -38, -10, -25, -25 + Math.sin(t * 4) * 5, -20);
    g.stroke();
    g.strokeStyle = '#c8c092';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-8, -48);
    g.lineTo(10, -48);
    g.stroke();
    g.fillStyle = '#d9e7d3';
    g.fillRect(6, -45, 2, 2);
    g.save();
    g.translate(14, -25);
    g.rotate(-0.65 + Math.sin(t * 2) * 0.05);
    blade(g, 0, 0, 0, 46, '#d5e4d1');
    g.strokeStyle = '#c1ab71';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(1, -6);
    g.lineTo(1, 6);
    g.stroke();
    g.restore();
    g.restore();
    if (!title) {
      g.textAlign = 'center';
      g.font = '12px "Microsoft YaHei",sans-serif';
      g.fillStyle = local ? '#f1e7cb' : color;
      g.strokeStyle = '#14262c';
      g.lineWidth = 3;
      g.strokeText(p.name, x, y - 69);
      g.fillText(p.name, x, y - 69);
      if (!local) {
        const width = 50;
        g.fillStyle = '#1b2d32';
        g.fillRect(x - width / 2, y - 61, width, 3);
        g.fillStyle = color;
        g.fillRect(x - width / 2, y - 61, width * clamp(p.hp / stats(p).hp, 0, 1), 3);
      }
    }
  }
  drawMonster(g, m, zone, alpha) {
    const x = lerp(m.px, m.x, alpha),
      y = lerp(m.py, m.y, alpha),
      t = this.time,
      boss = m.kind === 3,
      size = boss ? 1.9 : 1,
      palette = [
        ['#739c83', '#1c4945', '#c5ddae'],
        ['#bb7f63', '#61392f', '#ffd48c'],
        ['#9291c1', '#3d3d69', '#e4caff'],
      ][zone];
    g.save();
    g.translate(x, y);
    g.scale(size, size);
    ellipse(g, 0, 3, 24, 10, '#0a1d2866');
    const bob = Math.sin(t * 4 + m.id) * 2;
    g.translate(0, bob);
    const col = m.hurt > 0 ? '#fff0ce' : palette[0],
      dark = palette[1],
      glow = palette[2];
    if (m.kind === 0) {
      path(
        g,
        [
          [-20, 0],
          [-19, -16],
          [-12, -31],
          [0, -36],
          [15, -24],
          [21, -5],
          [13, 4],
          [3, -7],
          [-7, 5],
        ],
        dark,
        col,
        1.6
      );
      path(
        g,
        [
          [-13, -30],
          [-21, -48],
          [-3, -37],
          [9, -43],
          [18, -51],
          [17, -27],
          [3, -19],
        ],
        col,
        '#b9bda133'
      );
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-13, -17);
      g.lineTo(-31, -8 + Math.sin(t * 5) * 5);
      g.lineTo(-33, 2);
      g.moveTo(14, -16);
      g.lineTo(30, -9);
      g.lineTo(31, 2);
      g.stroke();
      ellipse(g, -5, -31, 3, 1.7, glow);
      ellipse(g, 7, -31, 3, 1.7, glow);
    } else if (m.kind === 1) {
      path(
        g,
        [
          [0, -50],
          [-18, -23],
          [-13, -1],
          [-24, 11],
          [0, 6],
          [23, 12],
          [13, -6],
          [17, -24],
        ],
        dark,
        col,
        1.5
      );
      path(
        g,
        [
          [-9, -30],
          [0, -41],
          [10, -30],
          [7, -21],
          [-6, -21],
        ],
        col
      );
      star(g, 0, -29, 6, glow, t * 0.5);
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(27, -22, 19, -1.7, 1.7);
      g.stroke();
      g.beginPath();
      g.moveTo(24, -41);
      g.lineTo(24, -3);
      g.stroke();
    } else {
      path(
        g,
        [
          [-24, 0],
          [-20, -41],
          [-11, -57],
          [13, -57],
          [25, -40],
          [28, 1],
          [12, 8],
          [-2, 1],
          [-12, 9],
        ],
        col,
        '#d5c89c66',
        1.5
      );
      path(
        g,
        [
          [-20, -39],
          [-33, -28],
          [-29, -6],
          [-18, -11],
        ],
        dark,
        col
      );
      path(
        g,
        [
          [20, -39],
          [33, -28],
          [30, -6],
          [20, -10],
        ],
        dark,
        col
      );
      path(
        g,
        [
          [-11, -50],
          [10, -50],
          [13, -39],
          [0, -29],
          [-13, -39],
        ],
        dark
      );
      g.fillStyle = glow;
      g.fillRect(-8, -43, 16, 3);
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = dark;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-16, -27 + i * 8);
        g.lineTo(0, -22 + i * 8);
        g.lineTo(18, -27 + i * 8);
        g.stroke();
      }
      if (boss) {
        g.strokeStyle = glow;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-10, -54);
        g.lineTo(-26, -75);
        g.lineTo(-16, -66);
        g.moveTo(11, -54);
        g.lineTo(27, -75);
        g.lineTo(18, -66);
        g.stroke();
        g.save();
        g.translate(0, -35);
        g.scale(1, 0.7);
        g.globalAlpha = 0.3;
        this.fx.sigil(g, 48, glow, t * 0.15);
        g.restore();
      }
    }
    if (m.slow > 0) {
      g.strokeStyle = '#abddff';
      g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++)
        blade(g, (i - 1.5) * 12, 5, -Math.PI / 2, 22 + (i % 2) * 15, '#b9deff', 0.5);
    }
    g.restore();
    if (m.hp < m.maxHp || boss) {
      const w = boss ? 100 : 42;
      g.fillStyle = '#172b30cc';
      g.fillRect(x - w / 2 - 1, y - (boss ? 162 : 63), w + 2, 5);
      g.fillStyle = boss ? '#d8ad78' : '#ad796c';
      g.fillRect(x - w / 2, y - (boss ? 161 : 62), (w * m.hp) / m.maxHp, 3);
      if (boss) {
        g.textAlign = 'center';
        g.font = '14px "KaiTi",serif';
        g.fillStyle = '#ebcc98';
        g.fillText(C.zones[zone].boss, x, y - 175);
      }
    }
  }
  drawProjectile(g, q, alpha) {
    const x = lerp(q.px, q.x, alpha),
      y = lerp(q.py, q.y, alpha);
    g.save();
    g.translate(x, y);
    g.rotate(q.angle);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.28;
    g.drawImage(this.fx.glow(q.color), -65, -45, 110, 90);
    g.globalAlpha = 1;
    if (q.style === 'dragon') {
      for (let j = 0; j < 3; j++) {
        g.lineWidth = j ? 2 : 18;
        g.globalAlpha = j ? 0.85 : 0.25;
        g.strokeStyle = q.color;
        g.beginPath();
        for (let i = 0; i < 36; i++) {
          const xx = -i * 7,
            yy = Math.sin(i * 0.24 - this.time * 13) * (12 + j * 3);
          i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      path(
        g,
        [
          [35, 0],
          [7, -16],
          [-12, -5],
          [-20, -27],
          [1, -13],
          [15, -8],
        ],
        '#d1ffdb'
      );
      path(
        g,
        [
          [35, 0],
          [7, 16],
          [-12, 5],
          [-20, 27],
          [1, 13],
          [15, 8],
        ],
        '#7ee5bb'
      );
    } else if (q.style === 'flame') {
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = i ? '#ffe6a6' : '#ed7155';
        g.lineWidth = 7 - i * 2;
        g.beginPath();
        g.moveTo(22, 0);
        g.quadraticCurveTo(-15, -22 - i * 6, -65, Math.sin(this.time * 18 + i) * 17);
        g.stroke();
        g.beginPath();
        g.moveTo(22, 0);
        g.quadraticCurveTo(-15, 22 + i * 6, -65, Math.sin(this.time * 18 + i) * 17);
        g.stroke();
      }
      star(g, 14, 0, 13, '#fff0be');
    } else if (q.style === 'enemy') {
      star(g, 0, 0, 12, '#ffc1a7', this.time * 5);
      g.strokeStyle = '#e9877166';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(-35, 0);
      g.lineTo(0, 0);
      g.stroke();
    } else {
      g.globalAlpha = 0.4;
      g.strokeStyle = q.color;
      g.lineWidth = q.style === 'basic' ? 4 : 8;
      g.beginPath();
      g.moveTo(-65, 0);
      g.lineTo(15, 0);
      g.stroke();
      g.globalAlpha = 1;
      blade(g, 0, 0, 0, q.style === 'basic' ? 24 : 40, q.color);
    }
    g.restore();
  }
  drawAtmosphere(g, z, layer) {
    const t = this.time,
      count = Math.floor(C.limits.ambience * this.fx.quality);
    g.save();
    if (!layer) {
      g.globalAlpha = 0.03;
      for (let i = 0; i < 7; i++) {
        const x = ((i * 410 + t * 8) % 2700) - 250,
          y = 230 + Math.sin(i * 7 + t * 0.1) * 400 + i * 150;
        g.drawImage(this.fx.glow(z.color), x - 250, y - 80, 650, 170);
      }
    } else
      for (let i = 0; i < count; i++) {
        const x = (i * 371.7 + t * (this.zone === 1 ? 9 : 13)) % C.world.width,
          y =
            (((i * 211.9 - t * (this.zone === 1 ? 24 : 8)) % C.world.height) + C.world.height) %
            C.world.height;
        g.globalAlpha = 0.18 + Math.sin(t + i) * 0.12;
        if (this.zone === 0) {
          g.save();
          g.translate(x, y);
          g.rotate(i + t * 0.5);
          path(
            g,
            [
              [-5, 0],
              [1, -2],
              [7, 0],
              [1, 2],
            ],
            '#c7d99f'
          );
          g.restore();
        } else star(g, x, y, this.zone === 1 ? 1.7 : 2.5, z.color, t * 0.3);
      }
    g.restore();
  }
  minimap(canvas, world, localId) {
    const g = canvas.getContext('2d'),
      p = world.players.get(localId);
    if (!p) return;
    const w = canvas.width,
      h = canvas.height;
    g.clearRect(0, 0, w, h);
    g.save();
    g.scale(w / C.world.width, h / C.world.height);
    g.fillStyle = '#102e2b';
    g.fillRect(0, 0, C.world.width, C.world.height);
    g.strokeStyle = '#547764';
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(1050, 1500);
    g.lineTo(1050, 850);
    g.lineTo(1670, 410);
    g.stroke();
    circle(g, 1050, 850, C.world.safeRadius, '#a0bea45c', 10);
    for (const s of C.exploration.shrines) star(g, s.x, s.y, 31, '#e8ca8c');
    for (const m of world.monsters)
      if (m.zone === p.zone && m.hp > 0) circle(g, m.x, m.y, m.kind === 3 ? 37 : 15, '#c38c72', 0);
    for (const f of world.players.values())
      if (f.zone === p.zone) {
        circle(
          g,
          f.x,
          f.y,
          f.id === localId ? 35 : 26,
          f.id === localId ? '#e8f4ce' : '#8bcfd8',
          0
        );
      }
    g.restore();
  }
}
