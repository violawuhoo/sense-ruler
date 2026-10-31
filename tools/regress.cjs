const { chromium } = require('playwright');
const FILE = process.argv[2] || 'file:///tmp/sr/proto_new.html';
(async () => {
  const errors = [], pageErrors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(FILE);
  await page.waitForFunction(() => window.__dbg && window.__dbg.phase, null, { timeout: 15000 });

  const total = await page.evaluate(() => window.__dbg.levels.length);
  const info = await page.evaluate(() => window.__dbg.levels.map(L => ({ id: L.id, cls: L.cls, shape: L.shape, band: L.band })));
  console.log('关卡数:', total);
  info.forEach((L, i) => console.log(`  ${i + 1}. ${L.id} [${L.cls}/${L.shape}] band=${JSON.stringify(L.band)}`));

  // ===== 成功路径：逐关按 band 中值出绳 =====
  let pass = 0;
  for (let i = 0; i < total; i++) {
    await page.waitForFunction(idx => window.__dbg.levelIndex === idx && window.__dbg.phase === 'ready', i, { timeout: 25000 });
    const t = await page.evaluate(() => {
      const L = window.__dbg.level; let lo = null, hi = null;
      for (let l = 0; l <= L.maxLen; l++) { const e = L.judge(l); if (e >= L.band[0] && e <= L.band[1]) { if (lo === null) lo = l; hi = l; } }
      return lo === null ? null : (lo + hi) / 2;
    });
    if (t === null) { console.log(`第${i + 1}关 band 无解 ❌`); break; }
    await page.mouse.move(500, 400); await page.mouse.down();
    await page.waitForFunction(tv => window.__dbg.ropeLen >= tv, t, { timeout: 15000 });
    await page.mouse.up(); await page.mouse.down();
    await page.waitForFunction(() => !['transforming'].includes(window.__dbg.phase), null, { timeout: 8000 });
    const ph = await page.evaluate(() => window.__dbg.phase);
    console.log(`  第${i + 1}关 ${info[i].id} 目标${t.toFixed(0)} → ${ph}`);
    if (ph === 'success' || ph === 'entering') pass++; else { console.log('  ❌ 未通过'); break; }
  }
  await page.waitForTimeout(3000);
  const endPhase = await page.evaluate(() => window.__dbg.phase);
  console.log('终局 phase:', endPhase, '(期望 ending/done)');
  await page.screenshot({ path: '/tmp/sr/new_end.png' });

  // ===== 失败路径：三关故意给短，验证 fail + 鬼影 + 快速重试 =====
  let failOK = 0;
  for (const idx of [1, 3, 6]) {
    await page.evaluate(i => { window.__dbg.clearSave(); window.__dbg.jump(i); }, idx);
    await page.waitForFunction(() => window.__dbg.phase === 'ready', null, { timeout: 15000 });
    await page.mouse.move(500, 400); await page.mouse.down();
    await page.waitForFunction(() => window.__dbg.ropeLen >= 60, null, { timeout: 8000 });
    await page.mouse.up(); await page.mouse.down();
    await page.waitForFunction(() => window.__dbg.phase === 'fail', null, { timeout: 8000 });
    const msg = await page.evaluate(() => window.__dbg.failMsg);
    const t0 = Date.now();
    await page.waitForFunction(() => window.__dbg.phase === 'ready', null, { timeout: 6000 });
    const rec = (Date.now() - t0) / 1000;
    console.log(`  失败路径 L${idx + 1} → "${msg}" 重试恢复 ${rec.toFixed(2)}s ${rec <= 2.0 ? '✅' : '⚠️超1.5s目标'}`);
    if (msg && rec <= 2.0) failOK++;
  }
  // ===== 仪表 & 存档 =====
  const rep = await page.evaluate(() => window.__dbg.report());
  console.log('仪表行数:', rep.rows.length, '| 信号:', JSON.stringify(rep.signals));
  const save = await page.evaluate(() => localStorage.getItem('sr_progress_v1'));
  console.log('存档:', save ? '已写入 ✅' : '无 ❌');

  console.log('console 错误:', errors.length, '| page 错误:', pageErrors.length);
  const ok = pass === total && failOK === 3 && rep.rows.length > 0 && save && errors.length === 0 && pageErrors.length === 0;
  console.log(ok ? 'REGRESS PASS ✅' : 'REGRESS FAIL ❌');
  await browser.close();
})();
