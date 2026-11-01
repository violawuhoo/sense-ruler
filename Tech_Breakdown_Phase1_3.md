# Sense Ruler（感知直尺）· Phase 1–3 技术侧任务拆解

> **文档性质**：技术侧生产计划（工程领队 程基岩）。**不写最终游戏代码、不修改 `index.html`**。
> 输入依据：`Visual_Upgrade_Spec.md`（V1–V4 / §4 实施清单 / §6.3 性能预算 / §7 函数级接口）、`Fun_Hypothesis_and_Pillars.md`（P1–P5）、`Comparable_Games_and_Direction.md` §7（已锁定方向）、当前 `index.html` 代码审查。
> **交付对象**：主理人 游承峰（与设计拆解合并成总生产计划）。
> 配套：本文每个任务含「任务ID / 目标 / 要改·新增函数与文件 / 关键数据结构·伪代码 / 验收标准 / 依赖 / 60fps 风险与降级」。

---

## 0. 前提确认与全局约束

### 0.1 已实装前提（V1+V2 已落地，勿重复劳动）
经代码审查，`index.html` 当前已含 V1/V2 成果，以下**不再作为新任务**，仅作回归基线：
- `strokeShape`(L94) 已含柔和投影层(L105)+主描边 9px(L106)+高光(L107)；`drawVerticalRope`(L731) 同。
- `ghostShape`(L110) 已含端点接触标记(L121–125)；`cueShape`(L128) 已为暖琥珀 `CUE_C`。
- `drawTreeShape`(L689) 已有机多瓣冠形；`drawGround`(L698) 已是单一暖土带+顶边高光。
- `fold` 的 `÷2` 公式文字已在 V1 清除（现 `scene` 内 `drawFlavor('对折',…)`，L268，无数值）。
- 调色板常量 `PAL`(L80)、`ROPE_C/H`(L89)、`GHOST_C`(L91)、`CUE_C`(L92) 已按 V2 锁定。

### 0.2 硬约束（贯穿三阶段，违反即 FAIL）
| 约束 | 含义 | 技术侧落点 |
|---|---|---|
| P1 | 操作不变只调总长 | Prologue / 章节 / 旅伴**绝不**新增决策维度；虎兔不可交互 |
| P2 | 定性不定量 | `drawHoldProgress` 显示相对填充、**零百分比/数字**；失败无数值 |
| P3 | 情境自明（遮文字 3 秒能懂） | 所有新增光影/雾/天气**不得削弱接触点可读性**；每阶段后跑 `?notext=1` 回归 |
| P5 | 判定宽松·snap 几何不可动 | V3 flourish/burst **仅 `ctx` 叠加层**，绝不改 `pts`/几何；`successT>0.6` 渲染点集 == `L.snap` |
| 零资源 | 纯程序化 | 无图片/字体/外部文件；全部 `ctx` 绘制 |
| 60fps | 移动端 | 见 §2 预算表；低端 Android 实测门槛待主理人拍板（§3 分叉 6） |

### 0.3 Phase 与 V 阶映射（来自 §7 锁定顺序）
- **Phase 1 = 问题2 无声 Prologue** → 新增 Prologue 入口 + `drawTouchAffordance`/`drawHoldProgress`/`drawGhostHand` + V4 文字降级收口。
- **Phase 2 = 问题1 的 A+C（V3 光影 / 章节色）** → `drawSoftShadow`（环境化）+ 大气透视 + vignette + `drawWaterShimmer` + 章节调色板系统 + 天气 + 渐变缓存。
- **Phase 3 = 问题3 + V4 角色/章节/旅伴** → 章节系统（LEVELS 分组+过渡+连续小路）+ 虎兔跟随状态机 + `drawCharacter` 重写 + 关名卡/flavor 降级。

---

## 1. 跨阶段全局架构改动（先于各 Phase 落地，避免返工）

> 这些改动被 Phase 1–3 共同依赖，建议作为「地基 Sprint」先行，或在 Phase 1 内一并完成。

### G1 · 状态机扩展点（文件 `index.html` `phase` L454 / `update` L599–648 / `pointerdown` L558）
- **新增可能相位**：`prologue`（Phase 1 推荐，见分叉 1）、过渡用 `chapter_transition`（Phase 3 复用现有 `walking` 即可，靠 palette 插值，不新增相位）。
- **约定**：所有新增相位必须进入 `activeLevelPhases` 判定（L602）与 `drawRopeShape` 相位白名单（L715）做兼容，否则不渲染形状。
- **数据结构**：`phase` 保持字符串枚举；新增 `prevChapterId` / `chapterBlend`(0–1) 两个模块级变量供 Phase 2/3 调色板插值。

### G2 · 质量档位系统（文件 `resize` L65 / 新增 `qualityTier()`）
```
// 依据 DPR 划分，决定树层数/粒子上限/微动开关
function qualityTier(){
  if (DPR <= 1.5) return 'low';   // 中低端 Android（720p/低 DPR）
  if (DPR <= 2.0) return 'mid';   // 主流 Android
  return 'high';                  // 旗舰 / 桌面
}
const Q = { low:{treeLayers:2, burst:12, weather:16, envMotion:false, vignette:true},
            mid:{treeLayers:3, burst:24, weather:24, envMotion:true,  vignette:true},
            high:{treeLayers:3, burst:24, weather:32, envMotion:true,  vignette:true} };
let TIER = Q.mid; // resize() 末尾 TIER = Q[qualityTier()];
```
- 所有 V3 微动/粒子/树层调用**必须经 `TIER` 门控**。

### G3 · 渐变缓存（文件 `drawSky` L679 / `door` scene L437 / `drawEnding` L815）
- 新增模块级 `let SKY_GRAD=null, GROUND_* …`；`buildGradients()` 在 `resize()` 末尾（L73 后）调用一次，按**当前章节调色板**构建 `createLinearGradient` 并缓存。
- `drawSky` 改为 `if(!SKY_GRAD) buildGradients(); ctx.fillStyle=SKY_GRAD; …`；`door` 暖光渐变改为章节化缓存（door 渐变当前每帧每可见 door 重建，L437，需缓存）。
- **收益**：消除每帧 `createLinearGradient`（§6.3 头号热点）。

### G4 · 章节感知调色板（文件 新增 `CHAPTERS` 常量 + `resolvePalette()`）
- 见 Phase 2 `P2-5` 数据结构。全局 `activePalette` 每帧由 `resolvePalette(currentChapterId, chapterBlend)` 求解（廉价对象合并）。
- `drawSky/drawTrees/drawGround/drawLevelElements` 现有 `PAL.*` 引用全部改为 `activePalette.*`（机械替换，约 12 处）。

### G5 · 调试/回归探针扩展（文件 `__dbg` L873，来自 §7）
- `hideText()`：`drawLevelText`/`drawMessage`/`drawFlavor` 内加 `if(__DBG_HIDETEXT) return;` 开关。
- `snapProbe()`：返回 `successT>0.6` 时 `drawRopeShape` 实际渲染点集（供 P5 逐点比对 `L.snap`，容差 0.5px）。
- URL 参数 `?notext=1` 直触 `hideText`；新增 `?fps=1` 帧率 overlay（见 §3 分叉 6）。

---

## Phase 1 · 无声 Prologue（技术侧）

> 核心：**前置一个无文字示范关**，用「鬼影手示范 + 触摸暗示 + 相对生长环」替代所有上手文字，且首次失败只重播示范、不教学。严守 P1（仅演示单一操作）/P2（无数值）/P3（本就无文字）。

### P1-1 · Prologue 入口与状态机
- **目标**：开机首次游玩进入 Prologue；非首次直接进入现有流程（intro→level）。仅首玩标记存 `localStorage`。
- **要改/新增函数**：`index.html` `update`(L599) 的 `intro` 分支改造；新增 `startPrologue()`；`SAVE_KEY` 旁新增 `PROLOGUE_KEY='sr_prologue_v1'`。
- **关键数据结构/伪代码**：
  ```
  function boot(){
    if (!localStorage.getItem(PROLOGUE_KEY)) { startPrologue(); }
    else { /* 现有 intro 逻辑（L607） */ }
  }
  function startPrologue(){
    phase='prologue'; phaseTimer=0; charX=120; cameraX=0;
    ropeLen=currentLevel?ropeLen:0; // prologue 自管 ropeLen
  }
  // update 内新增：
  if (phase==='prologue'){
    phaseTimer+=dt;
    if (phaseTimer>PROLOGUE_DEMO_LOOP) replayGhostHand(); // 循环示范
    // pointerdown 接管：进入 p-growing（复用 ready/growing 逻辑但无 hint 教学）
  }
  ```
- **验收标准**：① 首次打开自动播 Prologue，二刷（有 `PROLOGUE_KEY`）跳过；② Prologue 不写入 `LEVELS` 流程、不污染 `report()` 指标；③ 不引入第二决策维度（`__dbg.levels` 长度仍为 8）。
- **依赖**：G1（相位扩展）。
- **60fps 风险**：Prologue 场景极简（一棵树+地面+手+绳），绘制开销 < 常规关，无风险。
- **实现形态分叉**：见 §3 分叉 1（独立 `phase` vs 新 LEVELS 条目，本文推荐独立 `phase`）。

### P1-2 · 鬼影手示范动画 `drawGhostHand()`
- **目标**：Prologue 开场由一只「鬼影手」自动演示一次 `按住→绳生长→松手定长→过关`，玩家无需读字即懂机制。
- **要改/新增函数**：新增 `drawGhostHand(t)`（`index.html` 绘制区，与 `drawVerticalRope` 同层）；复用 `drawVerticalRope`(L731) 画绳，新增手剪影绘制（圆头+几指，纯炭色 `#3a3a30`）。
- **关键伪代码**：
  ```
  // t∈[0,1] 示范时间线：0–.4 按住生长，.4–.5 松手，.5–.8 放倒定长，.8–1 成功闪烁
  function drawGhostHand(t){
    const L = PROLOGUE_DEMO; // 一个临时 demo 关参数（handX/handY/maxLen）
    const demoLen = L.maxLen * Math.min(1, t/0.4);     // 生长段
    drawVerticalRope(L.handX, L.handY, demoLen, 1);
    drawHandSilhouette(L.handX, L.handY, t);            // 手随绳长上移
    if (t>0.5) L.renderShape(demoLen, easeOutCubic((t-0.5)/0.3), 0, null); // 放倒
    if (t>0.8) drawSnapFlourish(...);                   // 复用 V3 高光（Phase2 才实装，先预留空实现）
  }
  ```
- **验收标准**：① 示范在 1.2–1.8s 内自循环、无文字；② 示范只用「调总长」一个动作，不演示任何角度/比例/折点（P1）；③ 遮文字也能懂（P3 天然过）。
- **依赖**：P1-1、G1；`drawSnapFlourish` 占位（Phase 2 实装）。
- **60fps 风险**：1 手剪影 ≈ 5 个 arc/fill + 1 绳， negligible。

### P1-3 · `drawTouchAffordance()`（ready 相脉冲圈）
- **目标**：`ready` 相（含 Prologue 接管后）显示「按住任意处」的脉冲圈，替代文字提示，解决「不知道按哪」。
- **要改/新增函数**：新增 `drawTouchAffordance()`；在 `draw()`(L660) 的 UI 层（`drawLevelText` 前，L675 处）或 `drawRopeShape` 后调用，条件 `phase==='ready'`。
- **关键伪代码**：
  ```
  function drawTouchAffordance(){
    const cx=VIEW_W/2, cy=GROUND_Y-120, t=performance.now()/1000;
    const pulse = 0.5+0.5*Math.sin(t*2.2);
    ctx.save(); ctx.globalAlpha=0.25+0.35*pulse;
    ctx.strokeStyle=CUE_C; ctx.lineWidth=3; // 暖琥珀，与鬼影冷蓝区分
    ctx.beginPath(); ctx.arc(cx,cy, 26+8*pulse, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha=0.5; ctx.beginPath(); ctx.arc(cx,cy, 10, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    // 注意：不调用 fillText，纯手势暗示；现有 #hint 文字在 ready 相可置空
  }
  ```
- **验收标准**：① 仅 ready 相出现；② 纯图形无文字（P2/P3）；③ 不遮挡手持点/接触点可读性。
- **依赖**：无（可独立）。
- **60fps 风险**：2 个 arc/frame，零风险。

### P1-4 · `drawHoldProgress()`（growing 相相对生长环·非数值）
- **目标**：`growing` 相在手持点周围画一圈「相对生长」填充环，表达「还在长」，**绝不显示百分比/数值**。
- **要改/新增函数**：新增 `drawHoldProgress(handX,handY,ropeLen,maxLen)`；调用点：`drawRopeShape` 的 `['ready','growing','fixed']` 分支(L716)后，或使用 `currentLevel.handX/handY`。
- **关键伪代码**：
  ```
  function drawHoldProgress(x,y,len,maxLen){
    const frac = Math.max(0, Math.min(1, len/maxLen)); // 仅相对填充，无数字
    ctx.save();
    ctx.strokeStyle='rgba(240,168,92,0.9)'; ctx.lineWidth=4; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(x, y, 20, -Math.PI/2, -Math.PI/2 + Math.PI*2*frac); ctx.stroke();
    ctx.restore();
  }
  ```
- **验收标准**：① 环随绳长相对填充、`maxLen` 处满；② 画面无任何百分比/长度数字（P2 门：静态 grep 无数值）；③ 不与手持点(`ROPE_C` 实心圆 L740)视觉打架（环半径 20 > 手持点 5）。
- **依赖**：无。
- **60fps 风险**：1 arc/frame，零风险。

### P1-5 · 首次失败循环（只重播示范不教学）
- **目标**：Prologue 内若玩家释放时机/长度不当，不显示 `failShortHint` 类教学文字，仅软复位并自动重播 `drawGhostHand` 示范，回到可操作态。
- **要改/新增函数**：`update` 的 `prologue` 分支内新增失败判定（复用 `evaluate` 逻辑但**屏蔽 hint**）；新增 `replayGhostHand()` 重置 `phaseTimer` 与 `ropeLen`。
- **关键伪代码**：
  ```
  // prologue 内：玩家松手 → 轻量判定（用 demo 关 band，宽松 P5）
  if (phase==='prologue' && released){
    const ok = withinBand(ropeLen, PROLOGUE_DEMO);
    if (ok){ phase='prologue_done'; /* 短暂停顿 → startLevel(0) */ }
    else { ropeLen=initLen; phaseTimer=0; /* 不 setHint，不 onFail 教学 */ }
  }
  ```
- **验收标准**：① 失败不出现任何 `failShortHint`/数值教学（P2）；② 自动回 ready 并重播示范，零卡顿；③ 成功一次即写入 `PROLOGUE_KEY` 并进入 L1。
- **依赖**：P1-1、P1-2。
- **60fps 风险**：无。

### P1-6 · Prologue→L1 衔接 + 存档
- **目标**：Prologue 成功 → 平滑过渡到 `startLevel(0)`（复用现有 walking 入场），并落 `PROLOGUE_KEY`；选关面板(`openPanel` L842)不应暴露 Prologue。
- **要改/新增函数**：`startLevel`(L538) 不变；新增 `finishPrologue()` → `localStorage.setItem(PROLOGUE_KEY,'1')` + `startLevel(0)`；`resetGame`(L546) 不清除 `PROLOGUE_KEY`（重玩不强制再看 Prologue，符合「仅首玩」）。
- **验收标准**：① Prologue 完成标记持久化、二刷跳过；② 衔接无黑屏/跳变（复用 walking 入场动画）；③ `pReset`(L870) 清空进度时**保留** Prologue 标记（或按需一并清，待主理人定，见 §3 分叉）。
- **依赖**：P1-1。
- **60fps 风险**：无。

### 🔗 Phase 1 与文策渊（设计总监）接口
- **需设计交付《Prologue 分镜》**：鬼影手示范的时间线（生长时长/松手点/成功停顿）、Prologue 是否允许一句极轻氛围词（如全无文字则纯靠 P1-3 脉冲圈）、`PROLOGUE_DEMO` 关的场景布置（一棵树+地面+手持点坐标）。
- **需设计确认**：失败循环是否完全零文字（是，则 P1-5 不调任何 hint）；Prologue 与 L1 的视觉连贯（背景即晨雾林首章）。

### Phase 1 一句话核心
**用「鬼影手自动示范 + 脉冲触摸圈 + 相对生长环」替换一切上手文字，玩家看一遍就会，首次失败只重播不教学，仅首玩播放。**

---

## Phase 2 · V3 光影 + 章节色（技术侧）

> 核心：**把极简做高级**——共享 `drawSoftShadow` 给环境投影、大气透视/远雾/vignette 建深度、水面微光、章节调色板换主色与天气，全部走渐变缓存与 `TIER` 门控保 60fps。

### P2-1 · `drawSoftShadow(pts, closeIt)` 提取 + 环境软影
- **目标**：把 `strokeShape`(L105)/`drawVerticalRope`(L734) 已内联的「偏移半透明复制描边」抽成**共享函数**，并对环境/障碍/树落地处统一加低成本投影（非模糊卷积）。
- **要改/新增函数**：新增 `drawSoftShadow(pts, closeIt, opt)`；`strokeShape`/`drawVerticalRope` 改调它（去重）；`drawLevelElements`(L704) 内各 `L.scene` 调用后或 scene 内对障碍/立柱加 `drawSoftShadow`（传入其轮廓 pts）。
- **关键伪代码**：
  ```
  // 偏移复制描边：最多 2 次额外 stroke，无 blur（§6.3）
  function drawSoftShadow(pts, closeIt, opt={dx:2,dy:2,w:12,col:ROPE_SHADOW}){
    if (pts.length<2) return;
    ctx.save(); ctx.globalAlpha=opt.a??0.18; ctx.strokeStyle=opt.col;
    ctx.lineWidth=opt.w; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(pts[0][0]+opt.dx, pts[0][1]+opt.dy);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0]+opt.dx, pts[i][1]+opt.dy);
    if (closeIt) ctx.closePath(); ctx.stroke(); ctx.restore();
  }
  ```
- **验收标准**：① 绳/鬼影/主要障碍/树均有统一柔和落影；② 单形状 ≤2 次额外 stroke（§6.3）；③ 非模糊卷积（grep 无 `filter='blur'`）；④ 深度靠影可判、不误判前后（P3 回归）。
- **依赖**：G2（`TIER` 控制是否对全部树加影，低档仅对近景障碍加）。
- **60fps 风险**：可见障碍/树约 40–60 个 → +40–60 stroke/frame；中高档可接受；**低档降级**：仅近景障碍+绳加影，树不加（省 ~30 stroke）。

### P2-2 · 大气透视（parallax 加强 + 远雾）
- **目标**：强化三层树 parallax 深度差 + 远层叠加一层低 alpha 雾色，使远→近明度梯度更可信。
- **要改/新增函数**：`drawTrees`(L680) 按 `TIER.treeLayers` 决定层数；新增 `drawFarMist(activePalette)` 在远/中树后画一层 `rgba(skyBot,0.25)` 矩形/渐变（缓存渐变 G3）。
- **关键伪代码**：
  ```
  function drawFarMist(pal){
    ctx.save(); ctx.fillStyle = pal.mistRGBA; // 章节化雾色，如 'rgba(220,230,210,0.22)'
    ctx.fillRect(0, GROUND_Y*0.35, VIEW_W, GROUND_Y*0.65); ctx.restore();
  }
  ```
- **验收标准**：① 远树明显比近树浅/雾；② 雾不覆盖接触点（接触点在中近景，雾仅远层）；③ 遮文字仍可判形状（P3）。
- **依赖**：G3、G4、P2-5。
- **60fps 风险**：1 个 fillRect/渐变，零风险。

### P2-3 · 近景 vignette
- **目标**：画面边缘压暗 6%，聚焦中心绳与角色（§2.1 `rgba(40,35,25,0.06)`）。
- **要改/新增函数**：新增 `drawVignette()`，在 `draw()` UI 层最末（L677 前）调用；渐变缓存（G3）。
- **关键伪代码**：
  ```
  function drawVignette(){
    if(!VIGN_GRAD) {/* radial: 中心透明→边缘 rgba(40,35,25,0.06) */}
    ctx.fillStyle=VIGN_GRAD; ctx.fillRect(0,0,VIEW_W,VIEW_H);
  }
  ```
- **验收标准**：① 边缘压暗 ≤6% alpha，不遮关键 HUD/手持点；② 零文字影响（纯叠加）。
- **依赖**：G3、G2（低档可关，默认开）。
- **60fps 风险**：1 缓存渐变 fill，零风险。

### P2-4 · `drawWaterShimmer(x,y,w,h,t)`（水微光）
- **目标**：`arch` 等水面(§5.5 `WATER_C`)加横向流动 alpha 线，让水可信（仍是物理必然承载，P3）。
- **要改/新增函数**：新增 `drawWaterShimmer`；`arch` 的 `scene`(L322) 在水块后调用；受 `TIER.envMotion` 门控（低档静态）。
- **关键伪代码**：
  ```
  function drawWaterShimmer(x,y,w,h,t){
    if(!TIER.envMotion) return;
    ctx.save(); ctx.globalAlpha=0.35; ctx.strokeStyle=PAL.waterHi; // '#8fb3cf'
    for(let i=0;i<3;i++){ const off=(t*20+i*12)%w;
      ctx.beginPath(); ctx.moveTo(x+off,y+6+i*7); ctx.lineTo(x+off+18,y+6+i*7); ctx.stroke(); }
    ctx.restore();
  }
  ```
- **验收标准**：① 水有横向流动微光、不喧宾；② 低档 `envMotion=false` 时静止不耗；③ 不改接触点/水面几何（P3/P5）。
- **依赖**：G2、G4（waterHi 进 `PAL`/章色）。
- **60fps 风险**：≤3 短 stroke/frame×可见水块(~1) → negligible；低档直接 return。

### P2-5 · 章节调色板系统（数据结构）
- **目标**：2–3 章节（晨雾林/正午溪谷/黄昏围场）各有主色+天气+光，运行时按当前关章节求解 `activePalette`。
- **要改/新增函数**：新增 `CHAPTERS` 常量 + `resolvePalette(chId, blend)`；`LEVELS[]` 每项加 `chapter` 字段（见 §3 分叉 2，本文推荐字段内联）；`draw` 每帧算 `activePalette`。
- **关键数据结构**：
  ```
  const CHAPTERS = {
    ch1:{ id:'ch1', name:'晨雾林',
      palette:{ skyTop:'#eef3e8', skyBot:'#dce6d2', treeFar:'#cdd8c6', treeMid:'#a9bfa2',
                treeNear:'#86a07e', ground:'#b8a98f', groundTop:'#c9bca0', mistRGBA:'rgba(225,232,218,0.22)', waterHi:'#8fb3cf' },
      weather:{ type:'mist', density:0.6, wind:0.2 } },
    ch2:{ id:'ch2', name:'正午溪谷',
      palette:{ skyTop:'#eaf2f6', skyBot:'#cfe2e0', treeFar:'#bcd0c4', /*…*/, mistRGBA:'rgba(220,235,232,0.12)', waterHi:'#9fc3dc' },
      weather:{ type:'sun', shafts:0.4, wind:0.1 } },
    ch3:{ id:'ch3', name:'黄昏围场',
      palette:{ skyTop:'#f3e2cf', skyBot:'#e6c9a8', treeFar:'#c9b89a', /*…*/, mistRGBA:'rgba(230,200,168,0.18)', waterHi:'#caa877' },
      weather:{ type:'dusk', motes:0.5, wind:0.15 } },
  };
  // LEVELS 内联： { id:'gap', chapter:'ch1', … }（其余 7 关按映射表分配，见 §3 分叉）
  function resolvePalette(chId, blend=0, nextChId=null){
    const a = CHAPTERS[chId].palette, b = nextChId?CHAPTERS[nextChId].palette:null;
    if (!b || blend<=0) return {...PAL, ...a};
    // 逐字段线性插值 hex→rgb（仅颜色字段）；blend∈[0,1] 章节过渡用
    return lerpPalette(PAL, a, b, blend);
  }
  ```
- **验收标准**：① 每章主色/雾/水光明显不同；② `activePalette` 切换/插值无突变闪烁；③ 接触点颜色(障碍 `#3a352c`)在各章仍锐利可读（P3 回归每章各截一张）。
- **依赖**：G3、G4。
- **60fps 风险**：`resolvePalette` 每帧对象合并+少量插值，廉价；过渡插值仅在 `walking` 跨章时 `blend>0`，常态 `blend=0` 走快速分支。

### P2-6 · 天气效果（轻粒子/风，参数化）
- **目标**：mist 漂浮微粒 / sun 光轴 / dusk 浮尘，纯正弦+粒子、不建对象池、受 `TIER.weather` 上限。
- **要改/新增函数**：新增 `drawWeather(chId, t)`，`draw()` 在 `drawTrees` 之后、`translate(-cameraX)` 之前插入（屏幕空间漂移，读作远景）；粒子数 ≤ `TIER.weather`。
- **关键伪代码**：
  ```
  function drawWeather(chId, t){
    const w = CHAPTERS[chId].weather; const N = TIER.weather;
    ctx.save();
    if (w.type==='mist'){ ctx.fillStyle='rgba(255,255,255,0.10)';
      for(let i=0;i<N;i++){ const x=(i*137+t*30*w.wind)%VIEW_W, y=(i*97)%(GROUND_Y*0.7);
        ctx.beginPath(); ctx.arc(x,y, 18+ (i%3)*6, 0, Math.PI*2); ctx.fill(); } }
    else if (w.type==='sun'){ /* 2–3 条斜向光轴，缓存渐变，alpha=w.shafts */ }
    else if (w.type==='dusk'){ ctx.fillStyle='rgba(240,210,170,0.18)'; /* 浮尘小点 */ }
    ctx.restore();
  }
  ```
- **验收标准**：① 天气强化章节情绪但不遮接触点（mist 仅远景低 alpha）；② 粒子总数 ≤ `TIER.weather`（§6.3 上限 32）；③ 低档 `weather=16` 仍 ≥ 目标帧率。
- **依赖**：G2、P2-5。
- **60fps 风险**：N≤32 个 arc/frame，中高档 OK；**降级**：低档 `weather=16` 且 mist 半径缩小；若仍掉帧，优先关 `envMotion` 保绳/鬼影流畅（§6.3 优先级）。

### P2-7 · 渐变缓存（resize 时缓存，见 G3）
- **目标**：消除每帧 `createLinearGradient`（`drawSky` L679 / door L437 / 新增 vignette / mist）。
- **要改/新增函数**：`resize`(L65) 末尾调 `buildGradients()`；新增 `SKY_GRAD/VIGN_GRAD/MIST_GRAD/DOOR_GRAD` 模块级变量与 `buildGradients()`（按 `activePalette` 构建；章节切换时也需重建——`resolvePalette` 变化时置 `SKY_GRAD=null` 触发懒重建）。
- **验收标准**：① 每帧 `createLinearGradient` 调用数 = 0（grep 验证）；② 章节换色时渐变正确刷新、无残影。
- **依赖**：G3、P2-5。
- **60fps 风险**：缓存后每帧省 1–3 次渐变构建（移动端 `createLinearGradient` 非免费），直接降本。

### 🔗 Phase 2 与文策渊接口
- **需设计交付《章节→调色板规格》**：每章精确的 hex 覆盖值（本文 `CHAPTERS` 为占位，需美术总监林绘澄定稿）+ 天气 `type` 与 `density/wind/shafts/motes` 参数。
- **需设计确认**：章节命名与顺序（晨雾林→正午溪谷→黄昏围场）、各章是否强天气（如黄昏围场是否加风）。

### Phase 2 一句话核心
**共享低成本 `drawSoftShadow` 给环境投影 + 远雾/大气透视/vignette 建深度 + 水微光，并以章节调色板换主色与天气，全部渐变缓存 + `TIER` 门控守住 60fps。**

---

## Phase 3 · 章节重组 + 旅伴 + 角色（技术侧）

> 核心：**8 关分 2–3 章换主色/天气（Phase 2 已铺垫）、关间连续小路 + 章节过渡、虎兔变纯氛围无声旅伴全程跟随、角色重写出身份与生命感、关名卡/flavor 收口为三级文字层级。严守 P1（虎兔不可交互）/P3（文字降级不抢戏）。**

### P3-1 · 章节系统（LEVELS 分组 + 章节过渡 + 连续小路）
- **目标**：沿用现有世界坐标连续布局（WORLD_W=4200，角色 `walking` 已在关间行走），新增「章节归属 + 跨章 palette 插值过渡 + 章节衔接表现」。
- **要改/新增函数**：`LEVELS[]` 加 `chapter` 字段（P2-5）；`update` 的 `walking` 分支(L608)计算 `chapterBlend`：当 `walkTargetX` 跨章边界时，按 `charX` 进度在相邻两章 palette 间插值（写入 `G1` 的 `chapterBlend`/`prevChapterId`）；新增 `drawChapterCard()`（可选章节名卡，L1 样式，见 §3 分叉 3）。
- **关键伪代码**：
  ```
  // walking 中：确定当前/下章
  const cur = LEVELS[levelIndex], nxt = LEVELS[levelIndex+1];
  if (cur && nxt && cur.chapter!==nxt.chapter){
    const span = nxt.triggerX - cur.exitX;
    chapterBlend = clamp((charX - cur.exitX)/span, 0, 1);
    prevChapterId = cur.chapter; nextChapterId = nxt.chapter;
  } else { chapterBlend = 0; }
  // draw() 每帧：activePalette = resolvePalette(currentChapterId, chapterBlend, nextChapterId)
  ```
- **验收标准**：① 关间小路连续无硬切；② 跨章 palette 平滑过渡（无闪）；③ 章节名卡（若有）不破坏 P3 无文字验证（属 L1 可选）；④ 8 关仍全通、指标正常。
- **依赖**：P2-5、G1、G4。
- **60fps 风险**：插值计算廉价；章节卡若为文字则受 P3 约束，绘制 1 卡 negligible。

### P3-2 · 虎/兔跟随状态机（drawTiger/drawRabbit 扩展）
- **目标**：虎/兔从「仅 circle 关 predator-prey」改为**全程纯氛围无声旅伴**：跟随角色位移 + 待机微动（正弦呼吸/兔抖耳/虎甩尾），**不可交互**（不接管 pointer，不参与 judge）。
- **要改/新增函数**：`updateTiger`(L649) 重写为通用 `updateCompanions(dt)`；`drawTiger`(L743)/`drawRabbit`(L763) 扩展 `state` 参数支持 `'follow'/'idle'`；新增模块级 `companions=[{type:'tiger',offX:-130,t:0},{type:'rabbit',offX:-70,t:0}]`；`draw()` 世界 translate 内（L672 后）绘制。
- **关键伪代码**：
  ```
  function updateCompanions(dt){
    for(const c of companions){
      c.t += dt;
      const tx = charX + c.offX;                 // 跟随目标位移
      c.x = (c.x ?? tx) + (tx - (c.x??tx)) * Math.min(1, dt*3); // 缓动跟随
      c.y = GROUND_Y + Math.sin(c.t*1.5)*1.5;    // 待机呼吸微动
    }
  }
  function drawCompanions(){
    for(const c of companions){
      if (c.type==='tiger') drawTiger(c.x, c.y, c.t*6, 'follow');
      else drawRabbit(c.x, c.y, false); // rabbit 跟随态不 scare
    }
  }
  ```
- **验收标准**：① 虎兔全程（含非 circle 关）跟随、不交互（grep 无 companion 的 pointer 处理）；② 待机有生命微动、不喧宾；③ **circle 关原有 `stalking/pouncing/repelled`  predator 逻辑必须移除或中性化**（见 §3 分叉 4，本文推荐中性化为纯跟随，兔仍作被围对象几何但无被追叙事）；④ 不新增决策维度（P1）。
- **依赖**：无（`companions` 独立于 LEVELS）。
- **60fps 风险**：2 个角色绘制（各 ~10 arc/fill）≈ 20 ops/frame，零风险。

### P3-3 · `drawCharacter` 重写（身份 + squash/stretch + 呼吸 + 行走前倾）
- **目标**：V4 角色从裸剪影(L776)升级为「有辨识度 + 生命感」：身份轮廓（尖帽/围巾剪影，靠形状不靠色）、蓄力 squash、落定 rebound、待机呼吸、行走躯干前倾。
- **要改/新增函数**：重写 `drawCharacter`(L776)；新增 `applySquashStretch(sx,sy)` / `drawCharIdentity()` 辅助；颜色保持 `#3a3a30`（§5.4）。
- **关键伪代码**：
  ```
  function drawCharacter(){
    if (charAlpha<=0) return;
    const walking = ['walking','intro','success','entering'].includes(phase);
    const breathing = !walking ? 1 + Math.sin(performance.now()/900)*0.02 : 1; // 待机呼吸
    const squash = (phase==='growing') ? 0.96 : 1;     // 蓄力轻微压扁
    const rebound = (phase==='success') ? 1 + 0.08*Math.sin(successT*18)*Math.exp(-successT*4) : 1; // 落定回弹
    const lean = walking ? 0.12 : 0;                    // 行走前倾(rad)
    ctx.save(); ctx.globalAlpha=charAlpha; ctx.translate(charX, GROUND_Y);
    ctx.rotate(lean); ctx.scale(1/ (squash*rebound), squash*rebound*breathing);
    ctx.translate(-charX, -GROUND_Y);
    // 身份轮廓：尖帽 + 围巾（在现有 圆头+身+腿 基础上加形状，不改色）
    drawCharIdentity(charX, bodyY);
    // 既有身/腿/臂绘制（臂前倾、腿摆沿用 L785-791）
    ctx.restore();
  }
  ```
- **验收标准**：① 角色有辨识度（尖帽/围巾剪影）与生命感（呼吸/前倾/回弹）；② 颜色仍 `#3a3a30`，身份靠形状（§5.4）；③ squash/stretch 不破坏手持点对齐（`ready/growing/fixed` 手臂仍指 `handX/handY`，L789 逻辑保留）；④ 零文字、不抢戏。
- **依赖**：P1-4（手持点对齐）。
- **60fps 风险**：角色绘制 ~12 ops，零风险。

### P3-4 · 关名卡 / flavor 降级（drawLevelText / drawMessage / drawFlavor 收口）
- **目标**：V4 三级文字层级（§2.5）收口——L1 关名卡、L2 失败暖暗红、L3 flavor 轻灰去公式。当前 `drawLevelText`(L793) 已近 L1；`drawMessage`(L806) 需改暖暗红 `#7a3b2a` 600 24px；`drawFlavor`(L153) 已是 L3 轻灰（保留，确保 `circle/triangle/poly` 等内 `drawFlavor` 文案最终定稿，见 §3 分叉）。
- **要改/新增函数**：`drawMessage`(L806) 改 `fillStyle='#7a3b2a'`、`font='600 24px…'`、去卡；`drawLevelText`(L793) 对齐 `rgba(255,255,255,0.85)` + `#2e2b25` 600 26px；`drawFlavor` 确认 `rgba(70,60,45,0.5)` 11px（已符合）。
- **关键伪代码**：
  ```
  function drawMessage(){ if(!failMsg) return; ctx.save();
    ctx.fillStyle='#7a3b2a'; ctx.font='600 24px …'; ctx.textAlign='center';  // L2 暖暗红，无卡
    ctx.fillText(failMsg, VIEW_W/2, 160); ctx.restore(); }
  ```
- **验收标准**：① 三级层级清晰（L1 卡/L2 暖红/L3 轻灰）；② 仍无数值/公式（P2，grep 验证）；③ `?notext=1` 下全部消失且玩法自明（P3）；④ flavor 不抢接触点注意力。
- **依赖**：G5（`hideText` 开关）。
- **60fps 风险**：文字绘制每帧 ≤2 段 `fillText`，零风险（且仅 level_intro/success 限时）。

### 🔗 Phase 3 与文策渊接口
- **需设计交付《章节→关卡映射表》**：8 关如何分配至 2–3 章（如 ch1: gap/fold/lbrace；ch2: arch/circle；ch3: triangle/poly/door），及章节顺序。
- **需设计交付《旅伴行为脚本》**：虎/兔 `offX` 跟随间距、待机微动清单（兔抖耳频率、虎甩尾）、**circle 关虎兔是否中性化**（见分叉 4）。
- **需设计交付《关名卡/flavor 最终文案》**：L1 各关关名卡文案、L3 flavor 最终措辞（如保留「对折/围出三角」这类概念词还是全移除）、章节名卡文字或纯视觉。

### Phase 3 一句话核心
**把 8 关按映射表分章并平滑过渡、虎兔变全程纯氛围无声旅伴（删 predator 逻辑）、角色重写出身份与生命感、文字收口为三级层级——零新决策维度。**

---

## 2. 60fps 预算汇总（§6.3 落地版）

| 预算项 | 规格 | 门控 |
|---|---|---|
| 单帧 `createLinearGradient` | **0**（全部 G3 缓存） | 每 resize / 章切换重建 |
| 成功迸发粒子 | ≤ `TIER.burst`（低12/中高24） | `drawSuccessBurst` |
| 天气粒子 | ≤ `TIER.weather`（低16/中24/高32） | `drawWeather` |
| 树层 | `TIER.treeLayers`（低2/中高3） | `drawTrees` |
| 软影额外 stroke | 单形状 ≤2，总数受低档仅近景门控 | `drawSoftShadow` |
| 环境微动 | 低档 `envMotion=false`（静止保流畅） | `drawWaterShimmer`/叶呼吸 |
| vignette / 远雾 | 1 缓存渐变 fill，常开 | `drawVignette`/`drawFarMist` |
| 帧时间目标 | 中/高 ≥58fps；低 ≥ 待拍板（§3 分叉 6） | `?fps=1` overlay |

**降级优先级（与 §6.3 一致）**：先关 `envMotion`/天气粒子 → 再降树层 → 最后降软影范围；**永远保绳/鬼影流畅**（核心玩法信息，P2/P3 关键）。

---

## 3. 待主理人 / 用户拍板的技术分叉（Handoff ③）

1. **Prologue 实现形态**：独立 `phase`（推荐，不污染 `report`/LEVELS、失败循环干净）**vs** 新 `LEVELS` 条目（复用 startLevel 但会进指标、需特判无 judge）。*本文按计划 A 写。*
2. **章节数据结构**：`LEVELS[]` 每项内联 `chapter` 字段（推荐，设计易改、零查表）**vs** 外部 `LEVEL_TO_CHAPTER` 映射表。*本文按内联写。*
3. **章节过渡表现**：是否显示「章节名卡」（L1 样式文字，如「晨雾林」）**vs** 纯视觉 palette 过渡无文字。影响 P3 无文字验证范围，需设计定。
4. **circle 关虎/兔叙事**：保留现有「护兔御虎」predator 框架（与「纯氛围旅伴」方向冲突）**vs** 中性化为全程纯跟随（推荐，删 `stalking/pouncing/repelled`）。*本文按中性化写。*
5. **首玩标记与重置**：`pReset` 清空进度时是否一并清除 `PROLOGUE_KEY`（重看 Prologue）？建议**保留** Prologue 标记（仅首玩）。
6. **60fps 实测方案与设备档位**（重点）：需主理人确认 ① 低端 Android 具体机型/分辨率档（决定 `DPR≤1.5` 阈值是否够）；② 低端档可接受帧率下限（是否接受 45fps 而非 60）；③ 是否启用 `?fps=1` 帧率 overlay 与自动化 `performance.now()` 帧时采集作为验收手段。*本文已给出 `TIER` 框架与降级链，待门槛数值 sign-off。*

---

## 4. 验收/回归引用（每阶段收尾必跑）
- **P2 门**：静态 grep 全绘制代码无刻度/数值/`×÷+数字`；`fail`/ghost/cue 仅相对信息。`__dbg.hideText()` + `?notext=1` 关全部文字截图。
- **P3 门**：8 关（Phase 2 起每章各截 1 张）+ Prologue 共 `?notext=1` 截图，未玩者 3 秒判形；接触点数量 == 折点/闭合点数。
- **P5 门**：`__dbg.snapProbe()` 取 `successT>0.6` 渲染点集，与 `L.snap(ropeLen)` 逐点比对（容差 0.5px）；`drawSnapFlourish`/`drawSuccessBurst` 代码审查确认**不修改** `pts`/几何。
- **综合**：8 关全通、`?fps=1` 记录帧率、构建产物零图片/字体引用（grep `url(`/`.ttf`/`.png` 为空）。

---
*本文为技术侧任务拆解，未改动 `index.html`。待主理人 sign-off 分叉 1–6 后，与文策渊设计拆解合并成总生产计划，再进入实现。*
