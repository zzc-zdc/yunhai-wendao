import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../src/config.js';
import {
  World,
  createPlayer,
  cleanProfile,
  stats,
  requirements,
  priceFor,
} from '../src/simulation.js';
import { FixedClock, rng } from '../src/math.js';

const step = (world, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) world.step(1 / 60);
};
const command = (world, player, type, value) => world.command(player, { type, value });

test('60 / 144 / 165 Hz deliver identical fixed ticks, movement and cooldowns', () => {
  const runs = [60, 144, 165].map((hz) => {
    const world = new World(12),
      p = world.addPlayer('a');
    world.monsters = [];
    let seq = 0;
    p.x = p.px = 300;
    p.y = p.py = 800;
    p.cooldowns = [10, 10, 10];
    const clock = new FixedClock((dt) => {
      world.input('a', { seq: ++seq, x: 1, y: 0, aim: 0 });
      world.step(dt);
    });
    clock.advance(0);
    for (let i = 1; i <= hz * 5; i++) clock.advance((i * 1000) / hz);
    return { x: p.x, cooldown: p.cooldowns[0], tick: world.tick, mana: p.mana };
  });
  assert.deepEqual(runs[0], runs[1]);
  assert.deepEqual(runs[1], runs[2]);
  assert.equal(runs[0].tick, 300);
  assert.ok(Math.abs(runs[0].x - (300 + 245 * 5)) < 1e-7);
});
test('hidden/resume reset cannot catch up a background minute; long stalls bounded', () => {
  let ticks = 0;
  const c = new FixedClock(() => ticks++);
  c.advance(0);
  c.advance(100);
  assert.equal(ticks, 6);
  c.reset();
  c.advance(60100);
  assert.equal(ticks, 6);
  c.advance(60100 + 1000 / 60);
  assert.equal(ticks, 7);
  c.advance(160200);
  assert.ok(ticks <= 22);
});
test('clock reset from inside an update never creates a negative accumulator', () => {
  let count = 0;
  const clock = new FixedClock(() => {
    count++;
    clock.reset();
  });
  clock.advance(0);
  clock.advance(17);
  assert.equal(count, 1);
  assert.equal(clock.accumulator, 0);
  assert.equal(clock.last, null);
});
test('snapshots own mutable cooldown/cast data and reject invalid realm data', () => {
  const w = new World(),
    p = w.addPlayer('p');
  p.cooldowns[0] = 3;
  p.casting = { type: 'breakthrough', left: 2 };
  const s = w.snapshot();
  p.cooldowns[0] = 0;
  p.casting.left = 0;
  assert.equal(s.players[0].cooldowns[0], 3);
  assert.equal(s.players[0].casting.left, 2);
  s.players[0].realm = 99;
  assert.equal(new World().restore(s), false);
});
test('seeded generation and random continuation are deterministic', () => {
  const a = new World(543),
    b = new World(543);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const r = rng(32);
  r();
  const state = r.state(),
    value = r();
  r.restore(state);
  assert.equal(r(), value);
  const p = a.addPlayer('p');
  p.x = 1500;
  p.y = 500;
  b.restore(a.snapshot());
  step(a, 4);
  step(b, 4);
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test('profile sanitization rejects NaN, infinities, negative values and unsafe names', () => {
  const p = createPlayer('a', {
    realm: 400,
    coins: Infinity,
    materials: -100,
    forge: NaN,
    hp: -1,
    name: '<svg>\0你好',
    weapon: 900,
  });
  assert.equal(p.realm, 4);
  assert.equal(p.coins, 0);
  assert.equal(p.materials, 0);
  assert.equal(p.forge, 0);
  assert.equal(p.weapon, C.shop.weapon.max);
  assert.ok(p.hp > 0);
  assert.ok(!p.name.includes('<'));
  assert.equal(cleanProfile(null ?? {}).realm, 0);
});
test('rapid key commands survive frame batching and duplicate network packets', () => {
  const w = new World(),
    p = w.addPlayer('p');
  p.mana = 100;
  const commands = [0, 1, 2].map((value, n) => ({ type: 'skill', value, n: n + 1 }));
  w.input('p', { seq: 1, x: 0, y: 0, aim: 0, commands });
  w.input('p', { seq: 2, x: 0, y: 0, aim: 0, commands });
  w.step();
  assert.equal(w.drainEvents().filter((e) => e.type === 'cast').length, 3);
  assert.equal(p.acknowledged, 3);
  assert.equal(p.commands.length, 0);
  assert.ok(p.mana > 0);
});
test('all fifteen abilities produce distinct cast/release events and resolve damage', () => {
  const styles = new Set();
  for (let realm = 0; realm < 5; realm++)
    for (let slot = 0; slot < 3; slot++) {
      const w = new World(5),
        p = w.addPlayer('p', { realm });
      w.monsters = [];
      p.x = 1300;
      p.y = 900;
      p.angle = 0;
      const sk = C.skills[realm * 3 + slot];
      styles.add(sk.style);
      w.spawn(0, 0, { x: p.x + (sk.speed ? 150 : 70), y: p.y });
      const m = w.monsters[0];
      m.x = m.ox = p.x + (sk.speed ? 150 : 70);
      m.y = m.oy = p.y;
      m.hp = m.maxHp = 10000;
      m.cd = 100;
      command(w, p, 'skill', slot);
      step(w, sk.windup + 1);
      const events = w.drainEvents();
      assert.ok(
        events.some((e) => e.type === 'cast'),
        sk.name
      );
      assert.ok(
        events.some((e) => e.type === 'release'),
        sk.name
      );
      assert.ok(m.hp < m.maxHp, `${sk.name} must hit nearby target`);
      assert.ok(p.mana >= 0);
    }
  assert.equal(styles.size, 15);
});
test('cultivation, kills, loot, shop, forge, brew, breakthrough form a complete loop', () => {
  const w = new World(3),
    p = w.addPlayer('p');
  command(w, p, 'practice');
  step(w, 17);
  assert.equal(p.xp, C.realms[0].need);
  w.monsters = [];
  for (let i = 0; i < 20 && (p.materials < 3 || p.kills < 3); i++) {
    w.spawn(0, 0);
    const m = w.monsters.at(-1);
    m.x = p.x + 15;
    m.y = p.y;
    w.hitMonster(m, 9999, p, '#ffffff');
    step(w, 0.4);
  }
  assert.ok(p.kills >= 3);
  assert.ok(p.coins > C.player.initialCoins);
  assert.ok(p.materials >= 3);
  assert.ok(requirements(p).every((r) => r.ok));
  command(w, p, 'breakthrough');
  step(w, 3);
  assert.equal(p.realm, 1);
  assert.equal(p.xp, 0);
  assert.equal(p.hp, stats(p).hp);
  p.coins = 1000;
  p.materials = 30;
  p.herbs = 4;
  const before = stats(p).power;
  command(w, p, 'buy', 'weapon');
  command(w, p, 'forge');
  command(w, p, 'brew');
  assert.ok(stats(p).power > before);
  assert.equal(p.forge, 1);
  assert.equal(p.potions, 4);
  assert.equal(p.herbs, 2);
  assert.equal(priceFor(p, 'weapon'), 170);
});
test('breakthrough failure preserves realm; ward guarantees success; all five realms reachable', () => {
  const w = new World(10),
    p = w.addPlayer('p', { realm: 1, xp: 480, materials: 100, kills: 100, visited: 7, bosses: 5 });
  w.random = () => 0.999;
  command(w, p, 'breakthrough');
  step(w, 3);
  assert.equal(p.realm, 1);
  assert.equal(p.xp, 360);
  assert.ok(w.drainEvents().some((e) => e.type === 'ascendFail'));
  for (let i = 1; i < 4; i++) {
    p.xp = C.realms[i].need;
    p.ward = 1;
    command(w, p, 'breakthrough');
    step(w, 3);
    assert.equal(p.realm, i + 1);
  }
  assert.equal(p.realm, 4);
});
test('death and revival work without reloading and retain advancement', () => {
  const w = new World(),
    p = w.addPlayer('p', { realm: 2, coins: 200 });
  p.x = 1500;
  p.y = 1200;
  w.hitPlayer(p, 99999, { x: 1400, y: 1200 });
  assert.ok(p.down);
  assert.equal(p.hp, 0);
  command(w, p, 'revive');
  assert.equal(p.down, false);
  assert.equal(p.realm, 2);
  assert.equal(p.coins, 190);
  assert.equal(p.hp, stats(p).hp);
  assert.equal(p.x, C.world.spawn.x);
});
test('team scaling preserves health percentage; four-player admission and shared rewards', () => {
  const w = new World(1),
    p = w.addPlayer('a'),
    m = w.monsters[0];
  m.hp /= 2;
  const hp = m.maxHp;
  w.addPlayer('b');
  w.addPlayer('c');
  w.addPlayer('d');
  assert.ok(m.maxHp > hp * 2);
  assert.equal(m.hp / m.maxHp, 0.5);
  assert.throws(() => w.addPlayer('e'), /房间已满/);
  w.loot = [{ id: 900, x: p.x, y: p.y, zone: 0, life: 5, coins: 20, materials: 2, herbs: 1 }];
  w.step();
  for (const f of w.players.values()) {
    assert.equal(f.coins, 120);
    assert.equal(f.materials, 2);
  }
  w.removePlayer('b');
  assert.equal(w.players.size, 3);
});
test('travel gates, exploration one-time rewards and purchasing limits hold', () => {
  const w = new World(),
    p = w.addPlayer('p');
  command(w, p, 'travel', 2);
  assert.equal(p.zone, 0);
  p.realm = 1;
  command(w, p, 'travel', 1);
  assert.equal(p.zone, 1);
  p.x = C.exploration.shrines[0].x;
  p.y = C.exploration.shrines[0].y;
  command(w, p, 'explore');
  const coins = p.coins;
  command(w, p, 'explore');
  assert.equal(p.coins, coins);
  command(w, p, 'buy', 'potion');
  assert.equal(p.coins, coins);
  p.x = C.world.spawn.x;
  p.y = C.world.spawn.y;
  p.coins = 0;
  const potions = p.potions;
  command(w, p, 'buy', 'potion');
  assert.equal(p.potions, potions);
});
test('malformed snapshots, network input and command floods are bounded', () => {
  const w = new World(),
    p = w.addPlayer('p');
  assert.equal(w.restore({ v: 1 }), false);
  const bad = w.snapshot();
  bad.players[0].x = NaN;
  assert.equal(w.restore(bad), false);
  w.input('p', {
    seq: 1,
    x: NaN,
    y: Infinity,
    aim: NaN,
    commands: Array.from({ length: 10000 }, (_, n) => ({ type: 'skill', value: 100, n })),
  });
  w.step();
  assert.ok(Number.isFinite(p.x));
  assert.ok(Number.isFinite(p.y));
  assert.ok(p.commands.length <= C.simulation.maxCommands);
  assert.ok(w.events.length <= C.limits.events);
});
test('ten minutes of four-player AI simulation never produces NaN or unbounded entities', () => {
  const w = new World(928);
  for (let i = 0; i < 4; i++) {
    const p = w.addPlayer(`p${i}`, { realm: 4 });
    p.x = 1400 + i * 30;
    p.y = 450;
  }
  for (let i = 0; i < 36000; i++) {
    w.step();
    if (i % 60 === 0) w.drainEvents();
  }
  const s = w.snapshot();
  assert.ok(s.monsters.length <= 81);
  assert.ok(s.projectiles.length <= C.limits.projectiles);
  assert.ok(s.loot.length <= C.loot.max);
  for (const entity of [...s.monsters, ...s.players]) {
    assert.ok(Number.isFinite(entity.x));
    assert.ok(Number.isFinite(entity.y));
    assert.ok(entity.hp >= 0);
  }
});
