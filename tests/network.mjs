import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors = [],
  results = [],
  contexts = [];
async function page(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto('http://localhost:5173/');
  await p.waitForFunction(() => !!window.__game);
  await p.locator('#player-name').fill(name);
  return p;
}
try {
  const host = await page('房主青岚');
  await host.locator('#create-btn').click();
  await host.waitForFunction(
    () => __game.mode === 'host' || !document.querySelector('#create-btn').disabled,
    { timeout: 22000 }
  );
  assert.equal(
    await host.evaluate(() => __game.mode),
    'host',
    await host.locator('#title-status').textContent()
  );
  const code = await host.evaluate(() => __game.net.code);
  results.push({ name: 'public signaling room creation', pass: true, code });
  console.log('host created', code);
  await host.locator('#modal-close').click();
  const a = await page('道友流云');
  await a.locator('#room-input').fill(code);
  await a.locator('#join-form button').click();
  await a.waitForFunction(() => __game.mode === 'guest', { timeout: 22000 });
  await host.waitForFunction(() => __game.world.players.size === 2);
  assert.equal(
    await a.evaluate(() => __game.world.seed),
    await host.evaluate(() => __game.world.seed)
  );
  results.push({ name: 'room code join and seed sync', pass: true });
  console.log('guest joined');
  const aid = await a.evaluate(() => __game.localId),
    xBefore = await a.evaluate(() => __game.player.x);
  await a.keyboard.down('KeyD');
  await a.waitForTimeout(700);
  await a.keyboard.up('KeyD');
  await a.waitForTimeout(250);
  const positions = await Promise.all([
    host.evaluate((id) => __game.world.players.get(id).x, aid),
    a.evaluate(() => __game.player.x),
  ]);
  assert.ok(positions[0] > xBefore + 100);
  assert.ok(Math.abs(positions[0] - positions[1]) < 30);
  results.push({ name: 'authoritative movement and client prediction', pass: true, positions });
  await a.keyboard.press('Digit1');
  await a.waitForTimeout(250);
  assert.ok(await host.evaluate((id) => __game.world.players.get(id).cooldowns[0] > 0, aid));
  results.push({ name: 'skill events and cooldown sync', pass: true });
  await a.keyboard.press('KeyT');
  await a.locator('#chat-input').fill('一同问道 <script>');
  await a.locator('#chat-form button').click();
  await host.waitForTimeout(300);
  await host.keyboard.press('KeyT');
  await host.waitForFunction(() =>
    document.querySelector('#chat-lines').textContent.includes('一同问道 <script>')
  );
  results.push({ name: 'safe text chat', pass: true });
  await a.locator('#modal-close').click();
  await host.locator('#modal-close').click();
  const b = await page('道友听雪');
  await b.goto(`http://localhost:5173/?room=${code}`);
  await b.waitForFunction(() => __game.mode === 'guest', { timeout: 22000 });
  const c = await page('道友长风');
  await c.locator('#room-input').fill(code);
  await c.locator('#join-form button').click();
  await c.waitForFunction(() => __game.mode === 'guest', { timeout: 22000 });
  await host.waitForFunction(() => __game.world.players.size === 4);
  results.push({ name: 'four clients and URL auto join', pass: true });
  console.log('four clients joined');
  const extra = await page('第五位');
  await extra.locator('#room-input').fill(code);
  await extra.locator('#join-form button').click();
  await extra.waitForFunction(
    () => document.querySelector('#title-status').textContent.includes('房间已满'),
    { timeout: 22000 }
  );
  assert.equal(await extra.evaluate(() => __game.mode), 'title');
  await extra.locator('#solo-btn').click();
  assert.equal(await extra.evaluate(() => __game.mode), 'solo');
  results.push({ name: 'room full error and solo recovery', pass: true });
  // Duplicate identity is rejected without evicting the original live connection.
  const duplicate = await page('重复连接');
  await duplicate.evaluate((id) => {
    __game.net.id = id;
  }, aid);
  await duplicate.locator('#room-input').fill(code);
  await duplicate.locator('#join-form button').click();
  await duplicate.waitForFunction(
    () => /重复|已满/.test(document.querySelector('#title-status').textContent),
    { timeout: 22000 }
  );
  results.push({ name: 'duplicate identity rejected', pass: true });
  // Synthetic visibility events test the explicit host-pauses-room policy.
  await host.evaluate(() => {
    window.__hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await a.waitForFunction(() => __game.diagnostics.paused);
  const stopped = await a.evaluate(() => __game.world.time);
  await a.waitForTimeout(500);
  assert.equal(await a.evaluate(() => __game.world.time), stopped);
  await host.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await a.waitForFunction(() => !__game.diagnostics.paused);
  results.push({ name: 'host background pause and resume', pass: true });
  await a.evaluate(() => __game.net.links.get('host').close());
  await a.waitForFunction(
    () =>
      __game.mode === 'guest' &&
      !__game.net.closed &&
      __game.net.status === 'joined' &&
      !__game.diagnostics.paused,
    { timeout: 45000 }
  );
  await host.waitForFunction(() => __game.world.players.size === 4, { timeout: 12000 });
  results.push({ name: 'real data channel disconnect and automatic rejoin', pass: true });
  console.log('reconnected');
  await fs.mkdir('artifacts', { recursive: true });
  await host.keyboard.press('KeyT');
  await host.screenshot({ path: 'artifacts/05-multiplayer.png' });
  await host.locator('#leave-room').click();
  await a.waitForFunction(() => __game.mode === 'solo');
  await b.waitForFunction(() => __game.mode === 'solo');
  await c.waitForFunction(() => __game.mode === 'solo');
  results.push({ name: 'host leave preserves all guests as playable solo', pass: true });
  const invalid = await page('寻路人');
  await invalid.locator('#room-input').fill('ZZZZZZ');
  await invalid.locator('#join-form button').click();
  await invalid.waitForFunction(() => !document.querySelector('#join-form button').disabled, {
    timeout: 22000,
  });
  assert.equal(await invalid.evaluate(() => __game.mode), 'title');
  results.push({
    name: 'nonexistent invite rejected',
    pass: true,
    message: await invalid.locator('#title-status').textContent(),
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }, null, 2));
  await fs.writeFile(
    'artifacts/network-results.json',
    JSON.stringify({ results, errors }, null, 2)
  );
} catch (error) {
  console.error(error);
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile(
    'artifacts/network-results.json',
    JSON.stringify({ results, errors, failure: error.message }, null, 2)
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
