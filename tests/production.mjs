import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = process.env.TEST_URL || 'https://zzc-zdc.github.io/yunhai-wendao/';
const browser = await chromium.launch({
  ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  headless: true,
});
const errors = [],
  results = [];
await fs.mkdir('artifacts', { recursive: true });
async function open(url = base) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  return page;
}
const pass = (name) => {
  results.push({ name, pass: true });
  console.log('PASS', name);
};
try {
  const host = await open();
  assert.equal(await host.title(), '云海问道 · 与君共赴长生');
  assert.equal(await host.evaluate(() => typeof window.__game), 'undefined');
  await host.screenshot({ path: 'artifacts/production-title.png' });
  pass('public HTTPS entry and production-only bundle');
  await host.locator('#player-name').fill('青岚');
  await host.locator('#create-btn').click();
  await host.locator('.room-code').waitFor({ state: 'visible', timeout: 25000 });
  const code = (await host.locator('.room-code').textContent()).trim(),
    invite = host.url();
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(new URL(invite).searchParams.get('room'), code);
  assert.ok(new URL(invite).pathname.includes('yunhai-wendao'));
  const one = await open();
  await one.locator('#player-name').fill('听雪');
  await one.locator('#room-input').fill(code);
  await one.locator('#join-form button').click();
  await one.waitForFunction(
    (code) => document.querySelector('#team-label').textContent.includes(code),
    code,
    { timeout: 25000 }
  );
  const two = await open(invite);
  await two.waitForFunction(
    (code) => document.querySelector('#team-label').textContent.includes(code),
    code,
    { timeout: 25000 }
  );
  const three = await open();
  await three.locator('#player-name').fill('长风');
  await three.locator('#room-input').fill(code);
  await three.locator('#join-form button').click();
  await three.waitForFunction(
    (code) => document.querySelector('#team-label').textContent.includes(code),
    code,
    { timeout: 25000 }
  );
  await host.waitForFunction(
    () => document.querySelectorAll('#team-slots .team-slot:not(.empty)').length === 4
  );
  pass('four-player room from production URL; room-code and direct-link joins');
  await one.keyboard.press('Digit1');
  await one.waitForFunction(
    () => document.querySelector('.skill .cooldown-text').textContent.length > 0
  );
  pass('guest skill receives authoritative cooldown over real network');
  await one.keyboard.press('KeyT');
  await one.locator('#chat-input').fill('云海道友，部署验收通过。');
  await one.locator('#chat-form button').click();
  await host.waitForFunction(() =>
    document.querySelector('#chat-lines').textContent.includes('部署验收通过')
  );
  pass('public deployment chat synchronization');
  await host.screenshot({ path: 'artifacts/production-room.png' });
  await one.locator('#modal-close').click();
  await one.keyboard.press('Digit2');
  await one.waitForTimeout(400);
  await one.screenshot({ path: 'artifacts/production-game.png' });
  await host.locator('#leave-room').click();
  for (const guest of [one, two, three])
    await guest.waitForFunction(
      () => document.querySelector('#team-label').textContent === '结伴同行'
    );
  await one.locator('#modal-close').click();
  await one.keyboard.press('KeyC');
  await one.waitForFunction(
    () => !document.querySelector('#practice-label').classList.contains('hidden')
  );
  pass('host exit closes room; all guests retain playable solo sessions');
  assert.deepEqual(errors, []);
  pass('zero uncaught production browser errors');
  await fs.writeFile(
    'artifacts/production-results.json',
    JSON.stringify({ base, results, errors, invite, code }, null, 2)
  );
} catch (error) {
  console.error(error);
  await fs.writeFile(
    'artifacts/production-results.json',
    JSON.stringify({ base, results, errors, failure: error.message }, null, 2)
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
