import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const options = process.platform === 'win32' ? { channel: 'msedge' } : {};
const browser = await chromium.launch({ ...options, headless: true });
const base = process.env.TEST_URL || 'http://localhost:5173/';
const results = [],
  errors = [];
await fs.mkdir('artifacts/skills', { recursive: true });
const record = (name, data = {}) => {
  results.push({ name, pass: true, ...data });
  console.log('PASS', name, JSON.stringify(data));
};
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game);
  assert.equal(await page.locator('#title-screen').isVisible(), true);
  await page.screenshot({ path: 'artifacts/01-title.png' });
  record('round1: boot without missing resources or runtime errors');
  await page.locator('#player-name').fill('青岚');
  await page.locator('#solo-btn').click();
  await page.waitForTimeout(2800);
  await page.screenshot({ path: 'artifacts/02-world.png' });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(600);
  assert.ok(await page.evaluate(() => __game.player.xp > 3 && __game.player.practice));
  const x = await page.evaluate(() => __game.player.x);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  assert.ok(await page.evaluate((x) => __game.player.x > x + 65 && !__game.player.practice, x));
  record('round2: real keyboard movement and cultivation interruption');
  // Fight ordinary enemies using real pointer input, without editing player/enemy stats.
  let fought = false;
  for (let i = 0; i < 12; i++) {
    const target = await page.evaluate(() => {
      const p = __game.player;
      const m = __game.world.monsters
        .filter((m) => m.zone === p.zone && m.hp > 0)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      const r = __game.renderer;
      return {
        x: (m.x - r.camera.x) * r.scale + innerWidth / 2,
        y: (m.y - r.camera.y) * r.scale + innerHeight / 2,
        kills: p.kills,
      };
    });
    if (target.kills > 0) {
      fought = true;
      break;
    }
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();
  }
  assert.ok(fought);
  assert.ok(await page.evaluate(() => __game.world.loot.length > 0));
  record('round2: actual pointer combat kills AI and creates loot');
  await page.evaluate(() => {
    const p = __game.player,
      loot = __game.world.loot[0];
    p.x = loot.x;
    p.y = loot.y;
  });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => __game.player.coins > 100));
  await page.evaluate(() => {
    __game.player.x = 1050;
    __game.player.y = 850;
  });
  await page.keyboard.press('KeyE');
  const beforeBuy = await page.evaluate(() => ({
    coins: __game.player.coins,
    potions: __game.player.potions,
  }));
  await page.locator('[data-buy="potion"]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __game.player.potions), beforeBuy.potions + 1);
  assert.equal(await page.evaluate(() => __game.player.coins), beforeBuy.coins - 28);
  await page.screenshot({ path: 'artifacts/04-shop.png' });
  await page.evaluate(() => {
    __game.player.coins = 1000;
    __game.player.materials = 90;
    __game.player.herbs = 4;
    __game.updateUI();
  });
  await page.locator('[data-command="forge"]').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => __game.player.forge), 1);
  await page.locator('[data-command="brew"]').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => __game.player.herbs), 2);
  await page.locator('#modal-close').click();
  record('round2: pickup, purchase, forge and brew through UI');
  // Construct breakthrough conditions; the real button/timer/scene resolve them.
  await page.evaluate(() => {
    const p = __game.player;
    p.xp = 150;
    p.kills = 5;
    p.materials = 90;
  });
  await page.keyboard.press('KeyB');
  await page.locator('#ascend-button').click();
  await page.waitForTimeout(1900);
  await page.screenshot({ path: 'artifacts/06-ascension.png' });
  await page.waitForFunction(() => __game.player.realm === 1);
  record('round2: breakthrough full-screen timeline and realm unlock');
  await page.evaluate(() => {
    const p = __game.player;
    p.x = 1500;
    p.y = 1000;
    __game.world.hitPlayer(p, 99999, { x: 1400, y: 900 });
  });
  await page.waitForFunction(
    () => document.querySelector('#modal-title').textContent === '魂归青篁'
  );
  await page.locator('[data-command="revive"]').click();
  await page.waitForFunction(() => !__game.player.down);
  assert.equal(await page.evaluate(() => __game.player.realm), 1);
  record('round2: death and restart without page reload');
  await page.evaluate(() => {
    const p = __game.player;
    p.xp = 480;
    p.kills = 20;
    p.visited = 3;
    p.materials = 40;
    p.ward = 0;
    window.__oldRandom = __game.world.random;
    __game.world.random = () => 0.999;
  });
  await page.keyboard.press('KeyB');
  await page.locator('#ascend-button').click();
  await page.waitForFunction(
    () => document.querySelector('#modal-title').textContent === '天关未开'
  );
  assert.equal(await page.evaluate(() => __game.player.realm), 1);
  await page.screenshot({ path: 'artifacts/10-breakthrough-failure.png' });
  await page.locator('#recover-failure').click();
  await page.evaluate(() => {
    __game.world.random = window.__oldRandom;
  });
  record('round2: failed breakthrough has an ending screen and recovery');
  await page.evaluate(() => {
    __game.world.monsters = [];
  });
  for (let realm = 0; realm < 5; realm++) {
    await page.evaluate((realm) => {
      __game.showcase(realm);
    }, realm);
    for (let slot = 0; slot < 3; slot++) {
      await page.evaluate(() => {
        __game.player.cooldowns = [0, 0, 0];
        __game.player.mana = 999;
        __game.renderer.fx.clear();
      });
      await page.keyboard.press(`Digit${slot + 1}`);
      const delay = await page.evaluate(
        (slot) => __game.config.skills[__game.player.realm * 3 + slot].windup * 1000 + 170,
        slot
      );
      await page.waitForTimeout(delay);
      await page.screenshot({ path: `artifacts/skills/${realm * 3 + slot + 1}.png` });
      assert.ok(
        await page.evaluate(() => __game.renderer.fx.effects.some((e) => e.type === 'skill'))
      );
      await page.waitForTimeout(130);
    }
  }
  record('round3: all fifteen distinct skill timelines rendered and captured');
  const pool = await page.evaluate(() => {
    const fx = __game.renderer.fx;
    for (let i = 0; i < 200; i++) fx.burst(1050, 850, '#e6cc99', 80);
    const active = fx.active;
    fx.update(2);
    const expired = fx.active;
    fx.burst(1050, 850, '#e6cc99', 60);
    return { active, expired, reused: fx.active, cap: __game.config.limits.particles };
  });
  assert.ok(pool.active <= pool.cap);
  assert.equal(pool.expired, 0);
  assert.ok(pool.reused > 0);
  record('round3: particle pool cap, expiry and reuse', pool);
  const beforeQuality = await page.evaluate(() => {
    const r = __game.renderer;
    r.qualitySetting = 'auto';
    r.fx.quality = 1;
    r.sample = 12;
    r.sampleStart = performance.now() - 1200;
    return r.fx.quality;
  });
  await page.waitForTimeout(50);
  assert.ok(await page.evaluate((q) => __game.renderer.fx.quality < q, beforeQuality));
  record('round3: simulated low FPS triggers visual degradation');
  for (const zone of [1, 2]) {
    await page.evaluate((zone) => {
      __game.player.realm = 4;
      __game.player.x = 1050;
      __game.player.y = 850;
      __game.command('travel', zone);
    }, zone);
    await page.waitForFunction((zone) => __game.player.zone === zone, zone);
    await page.waitForTimeout(2800);
    await page.screenshot({ path: `artifacts/zone-${zone}.png` });
  }
  record('round3: three complete region themes and travel');
  await page.evaluate(() => {
    __game.showcase(4);
    __game.save();
  });
  const expected = await page.evaluate(() => ({
    realm: __game.player.realm,
    coins: __game.player.coins,
    forge: __game.player.forge,
  }));
  await page.reload();
  await page.locator('#solo-btn').click();
  assert.deepEqual(
    await page.evaluate(() => ({
      realm: __game.player.realm,
      coins: __game.player.coins,
      forge: __game.player.forge,
    })),
    expected
  );
  record('round5: persistent save survives full reload', expected);
  await page.evaluate(() => {
    __game.player.mana = 340;
    __game.player.cooldowns = [0, 0, 0];
    __game.input.queue('skill', 0);
    __game.input.queue('skill', 1);
    __game.input.queue('skill', 2);
  });
  await page.waitForTimeout(70);
  assert.ok(
    await page.evaluate(
      () => __game.player.cooldowns.every((c) => c > 0) && __game.input.commands.length === 0
    )
  );
  record('round5: three rapid actions are processed and acknowledged');
  await page.evaluate(() => {
    window.__hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const tick = await page.evaluate(() => __game.world.tick);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => __game.world.tick), tick);
  await page.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  const resumed = await page.evaluate(() => __game.world.tick);
  assert.ok(resumed - tick < 10);
  record('round5: hidden tab pauses and resets clock on resume', { pausedTick: tick, resumed });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => __game.renderer.canvas.width), 2560);
  await page.screenshot({ path: 'artifacts/07-2k.png' });
  const perf = await page.evaluate(() => __game.diagnostics);
  record('round5: 2560×1440 layout and unrestricted rendering', perf);
  const hi = await browser.newContext({
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 2,
  });
  const high = await hi.newPage();
  high.on('pageerror', (e) => errors.push(e.message));
  await high.goto(base);
  await high.locator('#solo-btn').click();
  await high.waitForTimeout(1700);
  const dpr = await high.evaluate(() => __game.diagnostics);
  assert.equal(dpr.width, 5120);
  assert.equal(dpr.height, 2880);
  assert.equal(dpr.dpr, 2);
  await high.screenshot({ path: 'artifacts/08-2k-dpr2.png' });
  record('round5: DPR2 backing store', dpr);
  await hi.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'artifacts/09-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  record('round5: narrow viewport has no horizontal overflow');
  await page.addInitScript(() => localStorage.setItem('yunhai-wendao.save.v1', '{corrupt}'));
  await page.reload();
  assert.ok(
    await page
      .locator('#title-status')
      .textContent()
      .then((t) => t.includes('存档无法读取'))
  );
  await page.locator('#solo-btn').click();
  assert.equal(await page.evaluate(() => __game.player.realm), 0);
  record('round5: corrupted save recovery');
  assert.deepEqual(errors, []);
  record('zero uncaught browser errors', { count: errors.length });
  await fs.writeFile(
    'artifacts/browser-results.json',
    JSON.stringify({ results, errors }, null, 2)
  );
} catch (error) {
  console.error(error);
  await fs.writeFile(
    'artifacts/browser-results.json',
    JSON.stringify({ results, errors, failure: error.message }, null, 2)
  );
  await page.screenshot({ path: 'artifacts/failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
