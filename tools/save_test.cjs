const { chromium } = require('playwright');
const FILE = 'file:///tmp/sr/proto_new.html';
async function playOne(page){
  await page.waitForFunction(() => window.__dbg.phase === 'ready', null, { timeout: 20000 });
  const t = await page.evaluate(() => {
    const L = window.__dbg.level; let lo=null,hi=null;
    for(let l=0;l<=L.maxLen;l++){const e=L.judge(l); if(e>=L.band[0]&&e<=L.band[1]){ if(lo===null)lo=l; hi=l; }}
    return lo===null?null:(lo+hi)/2;
  });
  await page.mouse.move(500,400); await page.mouse.down();
  await page.waitForFunction(tv=>window.__dbg.ropeLen>=tv, t, {timeout:15000});
  await page.mouse.up(); await page.mouse.down();
  await page.waitForFunction(()=>window.__dbg.phase==='success', null, {timeout:8000});
}
(async () => {
  const errors = [], pageErrors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:1000,height:640} });
  const page = await ctx.newPage();
  page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  page.on('pageerror', e=>pageErrors.push(String(e)));
  await page.goto(FILE);
  await page.evaluate(()=>{ localStorage.clear(); window.__dbg.clearSave(); window.__dbg.jump(2); });
  await playOne(page);                                  // 通关第 3 关（index 2）
  const save = await page.evaluate(()=>localStorage.getItem('sr_progress_v1'));
  console.log('通关后存档:', save);
  const parsed = JSON.parse(save || '{}');
  console.log('  levelIndex =', parsed.levelIndex, '(期望 3) | completed =', JSON.stringify(parsed.completed));
  await page.reload();                                  // 重新载入 → 应从存档续玩
  await page.waitForFunction(()=>window.__dbg.levelIndex >= 0, null, {timeout:15000});
  await page.waitForTimeout(1200);
  const idx = await page.evaluate(()=>window.__dbg.levelIndex);
  const done = await page.evaluate(()=>window.__dbg.completed);
  console.log('重开后 levelIndex =', idx, '(期望 3) | 已重建已完成形状数 =', done, '(期望 3)');
  const ok = parsed.levelIndex === 3 && idx === 3 && done === 3 && errors.length===0 && pageErrors.length===0;
  console.log('console 错误:', errors.length, '| page 错误:', pageErrors.length);
  console.log(ok ? 'SAVE/RESUME PASS ✅' : 'SAVE/RESUME FAIL ❌');
  await browser.close();
})();
