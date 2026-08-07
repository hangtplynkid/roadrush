/* =============================================================================
   Unity Pattern Pool — dùng chung cho browser (index.html) và node (export_unity.js)

   Unity (app.ts) bốc pattern ĐỘC LẬP cho từng segment 32m:
     tier = activeTime lớn nhất <= gameTime  ->  bốc 1 pattern trong tier đó
   Hai pattern bất kỳ trong cùng tier đều có thể nằm kề nhau, nên pool phải an
   toàn với MỌI cặp, không chỉ với thứ tự người thiết kế xếp.

   LATTICE: vật cản chỉ ở local y = -8 (hàng đầu) / +8 (hàng sau) trong segment 32m
   => khoảng cách hàng luôn là bội của 16m, kể cả khi vắt qua ranh giới segment.

   RÀNG BUỘC TỪ TỐC ĐỘ THẬT (dịch ngang 14 m/s -> 1 làn = 0.25s):
     16m @50 m/s = 0.32s -> đủ 1 làn, KHÔNG đủ 2 làn
     32m @50 m/s = 0.64s -> đủ 2 làn
   Luật pool:
     R1. Không hàng nào bịt cả 3 làn.
     R2. Hàng y=+8 không được chỉ mở đúng một làn BIÊN (L hoặc R).
         Nếu không, tồn tại cặp mở{L} -> mở{R} cách 16m -> cần 2 làn -> chết.
     R3. Trong cùng pattern, hai hàng chỉ được lệch tối đa 1 làn.
     R4. Oil đứng một mình trong segment (y=+8 trống) để có runway 32m.
============================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./level_design.js'));
  else root.UP = factory(root.LD);
})(typeof self !== 'undefined' ? self : this, function (LD) {
  'use strict';

  const { LANE_XS, LANE_TIME, SEG_H, GAME_TIME, SLIP_DUR,
          speedAt, distAtTime, timeAtDist } = LD;

  const ROW_GAP = 16;
  const V_MAX = speedAt(GAME_TIME);
  const LANE_NAME = ['L', 'C', 'R'];
  const MAX_SAFE_STREAK = 2;                 // khớp app.ts

  const openOf = blocked => [0, 1, 2].filter(l => blocked.indexOf(l) < 0);
  const minHop = (S, T) => {
    let m = 9;
    S.forEach(a => T.forEach(b => { m = Math.min(m, Math.abs(a - b)); }));
    return m;
  };

  /* ------------------------------------------------------------------ POOL */
  const single = l => ({ block: [l] });
  const gate = open => ({ block: [0, 1, 2].filter(x => x !== open) });
  const oilRow = l => ({ block: [l], oil: true });
  const P = (name, r1, r2, tier) => ({ name, r1: r1 || null, r2: r2 || null, tier });

  const POOL = [
    /* P1 — 1 vật cản, hoặc weave 2 hàng (mỗi hàng mở 2 làn) */
    P('P1_single_L', single(0), null, 3),
    P('P1_single_C', single(1), null, 3),
    P('P1_single_R', single(2), null, 3),
    P('P1_weave_LC', single(0), single(1), 3),
    P('P1_weave_LR', single(0), single(2), 3),
    P('P1_weave_CL', single(1), single(0), 3),
    P('P1_weave_CR', single(1), single(2), 3),
    P('P1_weave_RC', single(2), single(1), 3),
    P('P1_weave_RL', single(2), single(0), 3),

    /* P2 — thêm gate. Gate mở biên -> y=+8 trống (R2/R4).
       Gate mở C được phép ở y=+8 vì open={C} không phải làn biên. */
    P('P2_gate_openL', gate(0), null, 10),
    P('P2_gate_openC', gate(1), null, 10),
    P('P2_gate_openR', gate(2), null, 10),
    P('P2_gateC_then_L', gate(1), single(0), 10),
    P('P2_gateC_then_C', gate(1), single(1), 10),
    P('P2_gateC_then_R', gate(1), single(2), 10),
    P('P2_L_then_gateC', single(0), gate(1), 10),
    P('P2_C_then_gateC', single(1), gate(1), 10),
    P('P2_R_then_gateC', single(2), gate(1), 10),

    /* P2 trap — oil đứng một mình, y=+8 trống lấy runway */
    P('P2_oil_L', oilRow(0), null, 20),
    P('P2_oil_C', oilRow(1), null, 20),
    P('P2_oil_R', oilRow(2), null, 20),

    /* P3 — gate hàng đầu + vật cản hàng sau */
    P('P3_gateL_then_C', gate(0), single(1), 30),
    P('P3_gateL_then_R', gate(0), single(2), 30),
    P('P3_gateR_then_C', gate(2), single(1), 30),
    P('P3_gateR_then_L', gate(2), single(0), 30),
    P('P3_gateL_then_gateC', gate(0), gate(1), 30),
    P('P3_gateR_then_gateC', gate(2), gate(1), 30),
    P('P3_gateC_then_gateC', gate(1), gate(1), 30),

    /* P3 peak — cặp gate chặt nhất mà vẫn hợp lệ */
    P('P3_peak_gateC_L', gate(1), single(0), 45),
    P('P3_peak_gateC_R', gate(1), single(2), 45),
    P('P3_peak_gateL_gateC', gate(0), gate(1), 45),
    P('P3_peak_gateR_gateC', gate(2), gate(1), 45)
  ];

  const TIER_TIMES = [0, 3, 10, 20, 30, 45];
  const TIER_LABEL = {
    0: 'Grace', 3: 'P1 Single/Weave', 10: 'P2 Gate/Weave',
    20: 'P2 + Oil', 30: 'P3 Gate dày', 45: 'P3 Peak'
  };

  function buildTiers(pool) {
    return TIER_TIMES.map(t => ({
      activeTime: t,
      label: TIER_LABEL[t],
      patterns: t === 0
        ? [{ name: 'grace', r1: null, r2: null, tier: 0 }]
        : pool.filter(p => p.tier <= t)          // tier cộng dồn
    }));
  }

  /* ------------------------------------------------------------------ LINT */
  function lintPool(pool) {
    const errs = [];
    pool.forEach(p => {
      [[p.r1, -8], [p.r2, 8]].forEach(pair => {
        const r = pair[0], y = pair[1];
        if (!r) return;
        const open = openOf(r.block);
        if (!open.length) errs.push(p.name + ': hàng y=' + y + ' bịt cả 3 làn (R1)');
        if (y === 8 && open.length === 1 && open[0] !== 1) {
          errs.push(p.name + ': hàng y=+8 chỉ mở làn biên ' + LANE_NAME[open[0]] + ' (R2)');
        }
      });
      if (p.r1 && p.r2) {
        const hop = minHop(openOf(p.r1.block), openOf(p.r2.block));
        const dt = ROW_GAP / V_MAX;
        if (hop * LANE_TIME > dt + 1e-9) {
          errs.push(p.name + ': trong pattern cần dịch ' + hop + ' làn trong ' + dt.toFixed(2) + 's (R3)');
        }
        if (p.r1.oil || p.r2.oil) errs.push(p.name + ': oil phải đứng một mình (R4)');
      }
    });
    return errs;
  }

  /* Vét cạn mọi cặp pattern kề nhau ở tốc độ tối đa (trường hợp xấu nhất).
     Gap giữa hàng cuối của A và hàng đầu của B:
       A.r2 && B.r1 -> 16m ; thiếu một -> 32m ; thiếu cả hai -> 48m */
  function lintAdjacency(pool) {
    const errs = [];
    let pairs = 0;
    pool.forEach(A => pool.forEach(B => {
      const aLast = A.r2 || A.r1;
      const bFirst = B.r1 || B.r2;
      if (!aLast || !bFirst) return;
      pairs++;
      let gap = 32;
      if (A.r2 && B.r1) gap = 16;
      else if (!A.r2 && !B.r1) gap = 48;
      const hop = minHop(openOf(aLast.block), openOf(bFirst.block));
      if (hop * LANE_TIME > gap / V_MAX + 1e-9) {
        errs.push(A.name + ' -> ' + B.name + ': ' + hop + ' làn trong ' + (gap / V_MAX).toFixed(2) + 's');
      }
    }));
    errs.pairs = pairs;
    return errs;
  }

  /* --------------------------------- MÔ PHỎNG ĐÚNG PIPELINE UNITY (SFC32) */
  function SFC32(seed) {
    this.a = (seed ^ 0x55555555) >>> 0; this.b = (seed ^ 0xAAAAAAAA) >>> 0;
    this.c = (seed ^ 0x33333333) >>> 0; this.d = 1;
    for (let i = 0; i < 12; i++) this.u();
  }
  SFC32.prototype.u = function () {
    const t = (this.a + this.b + this.d) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.d = (t + this.d) >>> 0;
    return t;
  };
  SFC32.prototype.next = function (min, max) { return min + (this.u() % (max - min + 1)); };

  function simulate(tiers, seed, segCount) {
    const rng = new SFC32(seed);
    const laneFree = [0, 0, 0];
    const segs = [];
    let dist = 0;
    for (let i = 0; i < segCount; i++) {
      rng.next(0, 2);                            // ROAD_PATHS variant (app.ts luôn bốc)
      const t = timeAtDist(dist);
      let tierIdx = -1;
      for (let k = 0; k < tiers.length; k++) { if (t >= tiers[k].activeTime) tierIdx = k; else break; }
      let pat = { name: 'grace', r1: null, r2: null };
      if (tierIdx >= 0 && tiers[tierIdx].patterns.length) {
        const pool = tiers[tierIdx].patterns;
        let idx = rng.next(0, pool.length - 1);
        const need = laneFree.map(s => s >= MAX_SAFE_STREAK);
        if (need.some(Boolean)) {
          const score = p => {
            const b = [false, false, false];
            [p.r1, p.r2].forEach(r => r && r.block.forEach(l => b[l] = true));
            let s = 0; for (let l = 0; l < 3; l++) if (need[l] && b[l]) s++;
            return s;
          };
          const best = Math.max.apply(null, pool.map(score));
          if (best > 0) {
            const cands = [];
            pool.forEach((p, k) => { if (score(p) === best) cands.push(k); });
            idx = cands[rng.next(0, cands.length - 1)];
          }
        }
        pat = pool[idx];
      }
      const b = [false, false, false];
      [pat.r1, pat.r2].forEach(r => r && r.block.forEach(l => b[l] = true));
      for (let l = 0; l < 3; l++) laneFree[l] = b[l] ? 0 : laneFree[l] + 1;
      segs.push({ idx: i, dist, time: t, pat });
      dist += SEG_H;
    }
    return segs;
  }

  function validateRun(segs, checkOilRunway) {
    const rows = [];
    segs.forEach(s => {
      [[s.pat.r1, -8], [s.pat.r2, 8]].forEach(pair => {
        const r = pair[0], y = pair[1];
        if (r) {
          const wy = s.dist + SEG_H / 2 + y;
          rows.push({ y: wy, blocked: r.block, oil: !!r.oil, time: timeAtDist(wy) });
        }
      });
    });
    const errs = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      const gap = b.y - a.y;
      if (gap < ROW_GAP - 1e-9 || Math.abs(gap % ROW_GAP) > 1e-6) errs.push('lattice @' + (b.y | 0));
      if (!openOf(b.blocked).length) errs.push('bịt kín @' + (b.y | 0));
      const hop = minHop(openOf(a.blocked), openOf(b.blocked));
      const dt = gap / speedAt(b.time);
      if (hop * LANE_TIME > dt + 1e-9) errs.push('@' + (b.y | 0) + ' cần ' + hop + ' làn trong ' + dt.toFixed(2) + 's');
    }
    if (checkOilRunway) {
      rows.forEach((r, i) => {
        if (!r.oil) return;
        const nx = rows[i + 1];
        if (!nx) return;
        if ((nx.y - r.y) / speedAt(r.time) < SLIP_DUR) {
          errs.push('oil runway @' + (r.y | 0) + ' = ' + ((nx.y - r.y) / speedAt(r.time)).toFixed(2) + 's');
        }
      });
    }
    const st = [0, 0, 0]; let mx = 0;
    segs.forEach(s => {
      const b = [false, false, false];
      [s.pat.r1, s.pat.r2].forEach(r => r && r.block.forEach(l => b[l] = true));
      for (let l = 0; l < 3; l++) { st[l] = b[l] ? 0 : st[l] + 1; mx = Math.max(mx, st[l]); }
    });
    return { errs, maxFreeStreak: mx, rows: rows.length };
  }

  function stressTest(tiers, runs, checkOilRunway) {
    const segCount = Math.ceil(distAtTime(GAME_TIME) / SEG_H * 1.2);
    let bad = 0, worstStreak = 0, sample = null, totalRows = 0;
    for (let i = 0; i < runs; i++) {
      const seed = (Math.random() * 1e9) | 0;
      const r = validateRun(simulate(tiers, seed, segCount), checkOilRunway);
      totalRows += r.rows;
      if (r.errs.length) { bad++; if (!sample) sample = { seed, errs: r.errs.slice(0, 3) }; }
      worstStreak = Math.max(worstStreak, r.maxFreeStreak);
    }
    return { runs, pass: runs - bad, fail: bad, worstStreak, sample, segCount,
             avgRows: Math.round(totalRows / runs) };
  }

  /* ------------------------------------------------------- OIL CONFLICT */
  const OIL_RUNWAY = 32;                              // oil ở y=-8, y=+8 trống
  const SLIP_MAX_SAFE = OIL_RUNWAY / V_MAX;           // 0.64s
  const OIL_SAFE_SPEED = OIL_RUNWAY / SLIP_DUR;       // 32 m/s
  const OIL_SAFE_TIME = (function () {
    for (let t = 0; t <= GAME_TIME; t += 0.1) if (speedAt(t) > OIL_SAFE_SPEED) return t;
    return GAME_TIME;
  })();
  const OIL_CONFLICT = SLIP_MAX_SAFE < SLIP_DUR;

  /* Phương án B: bỏ oil khỏi tier có tốc độ cao */
  function tiersOilEarly(pool) {
    return buildTiers(pool).map(t => ({
      activeTime: t.activeTime,
      label: t.label,
      patterns: t.patterns.filter(p => {
        const hasOil = (p.r1 && p.r1.oil) || (p.r2 && p.r2.oil);
        return !hasOil || speedAt(t.activeTime) <= OIL_SAFE_SPEED;
      })
    }));
  }

  /* ------------------------------------------------------------- EXPORT */
  function toUnityJson(tiers) {
    return {
      roadPathPatternInfos: tiers.map(t => ({
        activeTime: t.activeTime,
        patterns: t.patterns.map(p => {
          const obstacles = [];
          [[p.r1, -8], [p.r2, 8]].forEach(pair => {
            const r = pair[0], y = pair[1];
            if (!r) return;
            r.block.forEach(l => obstacles.push({
              obstacleType: r.oil ? 'oil' : 'normal',
              position: { x: LANE_XS[l], y }
            }));
          });
          obstacles.sort((a, b) => a.position.y !== b.position.y
            ? a.position.y - b.position.y
            : a.position.x - b.position.x);
          return { patternName: p.name, obstacles };
        })
      }))
    };
  }

  /* Mô tả hàng dạng chữ để hiển thị: "gate mở C", "chặn L", "oil L", "—" */
  function rowLabel(r) {
    if (!r) return '—';
    const open = openOf(r.block);
    if (r.oil) return 'oil ' + r.block.map(l => LANE_NAME[l]).join('');
    if (r.block.length === 2) return 'gate mở ' + LANE_NAME[open[0]];
    return 'chặn ' + r.block.map(l => LANE_NAME[l]).join('');
  }

  return {
    ROW_GAP, V_MAX, LANE_NAME, MAX_SAFE_STREAK,
    POOL, TIER_TIMES, TIER_LABEL,
    buildTiers, tiersOilEarly,
    lintPool, lintAdjacency,
    simulate, validateRun, stressTest,
    toUnityJson, rowLabel, openOf, minHop,
    OIL_RUNWAY, SLIP_MAX_SAFE, OIL_SAFE_SPEED, OIL_SAFE_TIME, OIL_CONFLICT
  };
});
