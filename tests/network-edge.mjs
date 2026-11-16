import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  headless: true,
});
const results = [],
  errors = [];
async function create(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => !!window.__game);
  await page.locator('#player-name').fill(name);
  return page;
}
const record = (name) => {
  results.push({ name, pass: true });
  console.log('PASS', name);
};
try {
  const one = await create('浮生');
  await one.evaluate(() => {
    __game.connect(true);
    __game.startSolo();
  });
  await one.waitForTimeout(1000);
  assert.equal(await one.evaluate(() => __game.mode), 'solo');
  assert.equal(await one.evaluate(() => __game.net.closed), true);
  record('cancel pending connection releases resources and keeps solo playable');
  await one.evaluate(() => __game.connect(true));
  await one.waitForFunction(() => __game.mode === 'host');
  const oldCode = await one.evaluate(() => __game.net.code);
  await one.locator('#leave-room').click();
  const two = await create('长明');
  await two.locator('#create-btn').click();
  await two.waitForFunction(() => __game.mode === 'host', { timeout: 22000 });
  const code = await two.evaluate(() => __game.net.code);
  await one.evaluate((code) => __game.connect(false, code), code);
  assert.equal(await one.evaluate(() => __game.mode), 'guest');
  assert.ok(await one.evaluate(() => __game.localId.startsWith('p_')));
  record('former host can join another room with a valid new identity');
  await two.locator('#modal-close').click();
  // Delay actual outbound snapshots and inbound commands by 160 ms each.
  await two.evaluate(() => {
    const n = __game.net,
      receive = n.callbacks.packet.bind(n.callbacks),
      broadcast = n.broadcast.bind(n);
    n.callbacks.packet = (data, from) => setTimeout(() => receive(data, from), 160);
    n.broadcast = (data) => setTimeout(() => broadcast(data), 160);
  });
  const x = await one.evaluate(() => __game.player.x);
  await one.keyboard.down('KeyD');
  await one.waitForTimeout(750);
  await one.keyboard.up('KeyD');
  await one.waitForTimeout(900);
  const id = await one.evaluate(() => __game.localId);
  const a = await one.evaluate(() => __game.player.x),
    b = await two.evaluate((id) => __game.world.players.get(id).x, id);
  assert.ok(b > x + 100);
  assert.ok(Math.abs(a - b) < 25);
  record('320 ms injected round-trip delay converges to authoritative movement');
  await one.keyboard.press('Digit1');
  await one.waitForTimeout(800);
  assert.ok(await two.evaluate((id) => __game.world.players.get(id).cooldowns[0] > 0, id));
  record('skill command survives high latency');
  await two.evaluate(() => {
    window.__hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await one.waitForFunction(() => __game.diagnostics.paused);
  const late = await create('晚来');
  await late.goto(`http://localhost:5173/?room=${code}`);
  await late.waitForFunction(() => __game.mode === 'guest', { timeout: 22000 });
  assert.equal(await late.evaluate(() => __game.diagnostics.paused), true);
  record('joining while host is hidden receives paused state immediately');
  await two.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await late.waitForFunction(() => !__game.diagnostics.paused);
  await one.evaluate(() => {
    window.__hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await two.waitForFunction((id) => __game.world.players.get(id)?.connected === false, id);
  record('hidden guest becomes inactive and does not keep moving or attacking');
  await one.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await two.waitForFunction((id) => __game.world.players.get(id)?.connected === true, id);
  const offline = await create('独行客');
  await offline.context().setOffline(true);
  await offline.locator('#create-btn').click();
  await offline.waitForFunction(() => !document.querySelector('#create-btn').disabled, {
    timeout: 22000,
  });
  await offline.locator('#solo-btn').click();
  assert.equal(await offline.evaluate(() => __game.mode), 'solo');
  record('network failure leaves solo gameplay available');
  const sdk = await create('灵枢');
  await sdk.goto('http://localhost:5173/?room=K7QM&net=relay');
  await sdk.waitForFunction(() =>
    document.querySelector('#title-status').textContent.includes('公开 key')
  );
  await sdk.locator('#solo-btn').click();
  assert.equal(await sdk.evaluate(() => __game.mode), 'solo');
  record('GameRelay native code accepted; missing key fails gracefully');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors, oldCode }, null, 2));
  await fs.writeFile(
    'artifacts/network-edge-results.json',
    JSON.stringify({ results, errors }, null, 2)
  );
} catch (error) {
  console.error(error);
  await fs.writeFile(
    'artifacts/network-edge-results.json',
    JSON.stringify({ results, errors, failure: error.message }, null, 2)
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
