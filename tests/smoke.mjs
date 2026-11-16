import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await fs.mkdir('artifacts', { recursive: true });
try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'artifacts/01-title.png' });
  console.log('title', await page.title(), await page.locator('#title-screen').isVisible());
  await page.locator('#solo-btn').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'artifacts/02-world.png' });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1200);
  console.log(
    'practice',
    await page.evaluate(() => ({
      xp: __game.player.xp,
      practice: __game.player.practice,
      ...__game.diagnostics,
    }))
  );
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit2');
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/03-skills.png' });
  await page.keyboard.press('KeyE');
  await page.locator('[data-buy="potion"]').click();
  await page.waitForTimeout(300);
  console.log(
    'shop',
    await page.evaluate(() => ({ potions: __game.player.potions, coins: __game.player.coins }))
  );
  await page.screenshot({ path: 'artifacts/04-shop.png' });
  await page.locator('#modal-close').click();
  console.log('errors', errors);
} finally {
  await browser.close();
}
if (errors.length) process.exitCode = 1;
