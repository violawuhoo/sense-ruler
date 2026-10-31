const { chromium } = require('playwright');
(async () => {
  const errors = [], pageErrors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto('file:///tmp/sr/proto_dbg.html');

  // 原三关的判定目标（取自原版 LEVELS 的 band 中值）
  const targets = [194, 282, 220];
  for (let i = 0; i < targets.length; i++) {
    await page.waitForFunction(idx => window.__dbg.levelIndex === idx && window.__dbg.phase === 'ready', i, { timeout: 25000 });
    const t = targets[i];
    await page.mouse.move(500, 400); await page.mouse.down();
    await page.waitForFunction(tv => window.__dbg.ropeLen >= tv, t, { timeout: 15000 });
    await page.mouse.up();
    await page.mouse.down();
    await page.waitForFunction(() => !['transforming'].includes(window.__dbg.phase), null, { timeout: 8000 });
    const ph = await page.evaluate(() => window.__dbg.phase);
    console.log(`原版 第${i + 1}关 目标${t} → ${ph}`);
    if (ph !== 'success' && ph !== 'entering') { console.log('BASELINE FAIL at level', i + 1, ph); break; }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/sr/baseline.png' });
  console.log('console 错误:', errors.length, '| page 错误:', pageErrors.length);
  console.log((errors.length === 0 && pageErrors.length === 0) ? 'BASELINE PASS ✅' : 'BASELINE FAIL ❌');
  await browser.close();
})();
