#!/usr/bin/env node
/* =============================================================================
   Sinh road_path_patterns.json cho Unity.

   Ghi THẲNG vào road_path_patterns.json (file mà app.ts import), có backup .bak.
   Pool + lint + mô phỏng nằm ở unity_patterns.js (dùng chung với index.html).

   Cách dùng:
     node export_unity.js              kiểm tra + ghi road_path_patterns.json
     node export_unity.js --check      chỉ kiểm tra, không ghi file
     node export_unity.js --oil-early  dùng phương án B (oil chỉ ở đầu game)
     node export_unity.js --items      ghi thêm items.json (booster/gift)
============================================================================= */
const fs = require('fs');
const path = require('path');
const LD = require('./level_design.js');
const UP = require('./unity_patterns.js');

const { SEG_H, GAME_TIME, SLIP_DUR, LANE_XS, speedAt } = LD;
const { POOL, V_MAX, ROW_GAP, LANE_NAME } = UP;

const argv = process.argv.slice(2);
const has = f => argv.indexOf(f) >= 0;
const CHECK_ONLY = has('--check');
const OIL_EARLY = has('--oil-early');
const WITH_ITEMS = has('--items');

const TARGET = 'road_path_patterns.json';
const pad = (s, n) => String(s).padStart(n);
const line = (n = 74) => '─'.repeat(n);

let failed = false;

/* ------------------------------------------------------------------ 1. LINT */
console.log('\n' + line());
console.log(' ROAD RUSH · Pattern Export' + (OIL_EARLY ? '  [oil-early]' : ''));
console.log(line());

const poolErrs = UP.lintPool(POOL);
const adjErrs = UP.lintAdjacency(POOL);

console.log('\n[1] Luật pool (R1–R4)');
if (poolErrs.length) { failed = true; poolErrs.forEach(e => console.log('    ✗ ' + e)); }
else console.log('    ✓ ' + POOL.length + ' pattern hợp lệ');

console.log('\n[2] Mọi cặp pattern kề nhau  (' + adjErrs.pairs + ' cặp @' + V_MAX + ' m/s)');
if (adjErrs.length) {
  failed = true;
  adjErrs.slice(0, 6).forEach(e => console.log('    ✗ ' + e));
  if (adjErrs.length > 6) console.log('    … và ' + (adjErrs.length - 6) + ' cặp nữa');
} else console.log('    ✓ không cặp nào bất khả thi');

/* ------------------------------------------------------------------ 2. TIER */
const TIERS = OIL_EARLY ? UP.tiersOilEarly(POOL) : UP.buildTiers(POOL);

console.log('\n[3] Tier (cộng dồn, khớp cách app.ts chọn tier)');
console.log('    tier   pattern  max obs   speed   react/16m   oil');
TIERS.forEach(t => {
  const mx = Math.max(0, ...t.patterns.map(p =>
    (p.r1 ? p.r1.block.length : 0) + (p.r2 ? p.r2.block.length : 0)));
  const v = speedAt(t.activeTime);
  const react = ROW_GAP / v;
  const nOil = t.patterns.filter(p => (p.r1 && p.r1.oil) || (p.r2 && p.r2.oil)).length;
  const tight = react < LD.LANE_TIME * 1.15 ? ' ⚠' : '';
  console.log('    ≥' + pad(t.activeTime, 2) + 's ' + pad(t.patterns.length, 8) +
    pad(mx, 9) + pad(v.toFixed(0), 8) + pad(react.toFixed(2) + 's', 12) + tight +
    pad(nOil || '—', 6));
});

/* -------------------------------------------------------------- 3. MÔ PHỎNG */
const RUNS = 500;
const sim = UP.stressTest(TIERS, RUNS, OIL_EARLY);
console.log('\n[4] Mô phỏng pipeline Unity  (' + sim.segCount + ' segment/lần, ' + RUNS + ' seed)');
if (sim.fail) {
  failed = true;
  console.log('    ✗ ' + sim.pass + '/' + sim.runs + ' hợp lệ · seed ' + sim.sample.seed +
    ': ' + sim.sample.errs.join(' · '));
} else {
  console.log('    ✓ ' + sim.pass + '/' + sim.runs + ' hợp lệ · ' + sim.avgRows +
    ' hàng/lần · làn trống liên tiếp tối đa ' + sim.worstStreak + ' segment');
}

/* ------------------------------------------------------------------ 4. OIL */
console.log('\n[5] Runway sau oil  (slipping = ' + SLIP_DUR + 's)');
if (!UP.OIL_CONFLICT) {
  console.log('    ✓ runway ' + UP.OIL_RUNWAY + 'm = ' + UP.SLIP_MAX_SAFE.toFixed(2) + 's ≥ ' + SLIP_DUR + 's');
} else if (OIL_EARLY) {
  console.log('    ✓ oil chỉ ở tier speed ≤ ' + UP.OIL_SAFE_SPEED.toFixed(0) +
    ' m/s (activeTime < ' + UP.OIL_SAFE_TIME.toFixed(0) + 's) — runway đủ, giữ slipping ' + SLIP_DUR + 's');
} else {
  console.log('    ⚠ runway tối đa ' + UP.OIL_RUNWAY + 'm = ' + UP.SLIP_MAX_SAFE.toFixed(2) +
    's < slipping ' + SLIP_DUR + 's');
  console.log('      Pattern kế tiếp do Unity bốc độc lập nên không thể chừa thêm runway.');
  console.log('      Cần một trong hai:');
  console.log('        · sửa init_data.json → carState.slipping.activeDuration = ' + UP.SLIP_MAX_SAFE.toFixed(2));
  console.log('        · hoặc chạy lại với --oil-early (giữ slipping ' + SLIP_DUR + 's)');
}

/* ------------------------------------------------------------------ 5. GHI */
const json = UP.toUnityJson(TIERS);
json._designNote = OIL_EARLY
  ? 'Lattice: obstacle chỉ ở local y = -8 / +8 nên hàng luôn cách nhau bội số ' + ROW_GAP +
    'm. Oil đứng một mình (y=+8 trống) => runway 32m, và chỉ xuất hiện ở tier có speed <= ' +
    UP.OIL_SAFE_SPEED.toFixed(0) + ' m/s (activeTime < ' + UP.OIL_SAFE_TIME.toFixed(0) +
    's) nên giữ được carState.slipping.activeDuration = ' + SLIP_DUR + '.'
  : 'Lattice: obstacle chỉ ở local y = -8 / +8 nên hàng luôn cách nhau bội số ' + ROW_GAP +
    'm. Oil đứng một mình (y=+8 trống) => runway 32m. YÊU CẦU: đặt ' +
    'carState.slipping.activeDuration = ' + UP.SLIP_MAX_SAFE.toFixed(2) +
    ' trong init_data.json để runway đủ ở tốc độ tối đa ' + V_MAX + ' m/s.';

const entries = json.roadPathPatternInfos.reduce((s, t) => s + t.patterns.length, 0);
const uniqNames = new Set();
json.roadPathPatternInfos.forEach(t => t.patterns.forEach(p => uniqNames.add(p.patternName)));
const uniq = uniqNames.size;

console.log('\n[6] Nội dung xuất ra');
console.log('    ' + TIERS.length + ' tier · ' + entries + ' entry · ' + uniq +
  ' pattern riêng biệt (tier cộng dồn nên pattern lặp lại ở tier sau)');

if (CHECK_ONLY) {
  console.log('\n' + line());
  console.log(failed ? ' KẾT QUẢ: CÓ LỖI — không ghi file' : ' KẾT QUẢ: OK (--check nên không ghi file)');
  console.log(line() + '\n');
  process.exit(failed ? 1 : 0);
}

if (failed) {
  console.log('\n' + line());
  console.log(' KẾT QUẢ: CÓ LỖI — KHÔNG ghi file để tránh đưa map hỏng vào Unity');
  console.log(line() + '\n');
  process.exit(1);
}

/* backup file cũ rồi ghi mới */
if (fs.existsSync(TARGET)) {
  fs.copyFileSync(TARGET, TARGET + '.bak');
}
fs.writeFileSync(TARGET, JSON.stringify(json, null, 2));

const kb = f => (fs.statSync(f).size / 1024).toFixed(1) + ' KB';
console.log('\n[7] Đã ghi file');
console.log('    ' + TARGET + '  (' + kb(TARGET) + ')' +
  (fs.existsSync(TARGET + '.bak') ? '   ← bản cũ lưu ở ' + TARGET + '.bak' : ''));

if (WITH_ITEMS) {
  const combos = [];
  ['A', 'B', 'C'].forEach(a => ['A', 'B', 'C'].forEach(b => ['A', 'B', 'C'].forEach(c => {
    const M = LD.buildMap({ P1: a, P2: b, P3: c });
    combos.push({
      combo: a + '-' + b + '-' + c,
      items: M.items.map(it => ({
        type: it.type, lane: LANE_NAME[it.lane], x: LANE_XS[it.lane],
        distanceY: Math.round(it.dist), atSecond: +it.time.toFixed(1), context: it.ctx
      }))
    });
  })));
  fs.writeFileSync('items.json', JSON.stringify({
    note: 'Schema roadPathPatternInfos của Unity không có booster/gift. ' +
          'Spawn riêng theo distanceY (world Y) + x (lane).',
    lanes: { L: LANE_XS[0], C: LANE_XS[1], R: LANE_XS[2] },
    combos
  }, null, 2));
  console.log('    items.json  (' + kb('items.json') + ')   booster/gift cho 27 tổ hợp');
}

console.log('\n' + line());
console.log(' KẾT QUẢ: OK — thả ' + TARGET + ' vào Unity là chạy được');
if (UP.OIL_CONFLICT && !OIL_EARLY) {
  console.log(' NHỚ: đặt carState.slipping.activeDuration = ' + UP.SLIP_MAX_SAFE.toFixed(2) + ' trong init_data.json');
}
console.log(line() + '\n');
