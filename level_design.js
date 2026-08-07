/* =============================================================================
   Road Rush — Level Design Core
   Dùng chung cho index.html (browser) và harness kiểm tra (node).

   THIẾT KẾ: map = ghép 3 phase, mỗi phase có 3 biến thể A/B/C soạn tay.
   27 tổ hợp, hoàn toàn tất định — không seed, không random runtime.

   LATTICE: mỗi segment 32m có 2 hàng, local y = -8 (row1) và +8 (row2).
   => world y của hàng luôn là seg*32+8 hoặc seg*32+24, tức mọi hàng cách nhau
      đúng bội số của 16m, kể cả khi vắt qua ranh giới segment hay ranh giới phase.

   RÀNG BUỘC TỐC ĐỘ (lý do tồn tại của bộ khối bên dưới):
     đổi 1 làn = 3.5 / 14 = 0.25s
     16m @ 50 m/s = 0.32s  -> đủ 1 làn, KHÔNG đủ 2 làn
     32m @ 50 m/s = 0.64s  -> đủ 2 làn
   => Hàng chỉ còn 1 làn mở (gate) BẮT BUỘC phải cách hàng sau 32m.
      Vì vậy gt() luôn chiếm row1 và để trống row2.
      Chỉ các hàng còn >=2 làn mở mới được xếp dày 16m (wv, gsx-row2, oil).
============================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- CONFIG */
  const GAME_TIME = 60;
  const SEG_H = 32;
  const ROAD_W = 16;
  const LANE_XS = [-3.5, 0, 3.5];
  const LANE_W = 3.5;
  const ROW_GAP = 16;                 // bước lattice
  const ROW_LOCAL_Y = { 1: -8, 2: 8 };

  const SPEED_LEVELS = [
    { t: 0, v: 20 }, { t: 10, v: 30 }, { t: 30, v: 40 }, { t: 60, v: 50 }
  ];

  const OBSTACLES = [
    { id: 'oil', type: 'oil', w: 3.28, h: 2.33 },
    { id: 'fence', type: 'normal', w: 3.51, h: 2.64 },
    { id: 'cone', type: 'normal', w: 1.9, h: 2.41 },
    { id: 'tire', type: 'normal', w: 3.3, h: 2.57 }
  ];
  const OBS_MAP = {};
  OBSTACLES.forEach(o => OBS_MAP[o.id] = o);
  const NORMAL_POOL = ['fence', 'cone', 'tire'];

  const CAR_W = 2.49, CAR_H = 3.965;
  const LATERAL_V = 14;                        // m/s dịch ngang
  const CAR_LIMIT_X = 5.25;                    // biên đường (app.ts CarLimitX)
  const LANE_TIME = LANE_W / LATERAL_V;        // 0.25s
  const REACT_MARGIN = 1.15;                   // hệ số an toàn cho hàng gần nhất

  const SLIP_DUR = 1.0, COLLIDE_DUR = 2.5, COLLIDE_MULT = 0.25;
  const BOOST_DUR = 5.0, BOOST_MULT = 1.35, BOOST_SCORE = 150, GIFT_SCORE = 600;
  const N_BOOST = 2, N_GIFT = 1;
  const ITEM_W = 2.6, ITEM_H = 2.6;

  const MAX_DENSE_RUN = 6;      // số segment có vật cản liên tiếp tối đa
  const MAX_FREE_STREAK = 5;    // số segment một làn được trống liên tiếp
  const ITEM_MIN_SPACING = 250; // m
  const BOOST_WINDOW = [10, 48];
  /* Quà đặt ở GIỮA P2 (P2 = 10–30s). Trước đây quà nằm cuối P3 (~57s, ~2150m),
     tức 93% quãng đường chạy sạch — chỉ 3 va chạm là không tới nổi nên hầu như
     không ai thấy. Ở giữa P2 còn hơn 1600m dư địa phía sau. */
  const GIFT_WINDOW = [16, 28];
  const HIT_BUDGET = 5;         // người chơi bình thường ăn ~5 va chạm

  /* ------------------------------------------------------- SPEED / DISTANCE */
  function speedAt(t) {
    for (let i = 0; i < SPEED_LEVELS.length; i++) {
      const c = SPEED_LEVELS[i], n = SPEED_LEVELS[i + 1];
      if (n && t >= c.t && t < n.t) return c.v + (n.v - c.v) * ((t - c.t) / (n.t - c.t));
      if (!n && t >= c.t) return c.v;
    }
    return SPEED_LEVELS[0].v;
  }

  function distAtTime(T) {
    let d = 0;
    for (let i = 0; i < SPEED_LEVELS.length; i++) {
      const c = SPEED_LEVELS[i], n = SPEED_LEVELS[i + 1];
      const s = c.t, e = n ? Math.min(n.t, T) : T;
      if (s >= T) break;
      const dt = e - s;
      const vE = n ? c.v + (n.v - c.v) * (dt / (n.t - c.t)) : c.v;
      d += (c.v + vE) / 2 * dt;
    }
    return d;
  }

  function timeAtDist(dist) {
    let d = 0, t = 0;
    for (let i = 0; i < SPEED_LEVELS.length; i++) {
      const c = SPEED_LEVELS[i], n = SPEED_LEVELS[i + 1];
      const s = c.t, e = n ? Math.min(n.t, GAME_TIME) : GAME_TIME;
      if (s >= GAME_TIME) break;
      const dt = e - s;
      const segD = n
        ? ((c.v + (c.v + (n.v - c.v) * (dt / (n.t - c.t)))) / 2) * dt
        : c.v * dt;
      if (d + segD >= dist) {
        const need = dist - d;
        if (n) {
          const a = (n.v - c.v) / (n.t - c.t);
          if (a === 0) return t + need / c.v;
          return t + (-c.v + Math.sqrt(c.v * c.v + 2 * a * need)) / a;
        }
        return t + need / c.v;
      }
      d += segD; t += dt;
    }
    // vượt 60s: ngoại suy ở tốc độ cuối (vùng dự phòng boost)
    return GAME_TIME + (dist - d) / SPEED_LEVELS[SPEED_LEVELS.length - 1].v;
  }

  const BASE_DIST = distAtTime(GAME_TIME);                                  // 2300m
  const BOOST_RESERVE = Math.ceil(N_BOOST * BOOST_DUR * 45 * (BOOST_MULT - 1)); // 158m
  const NEED_DIST = BASE_DIST + BOOST_RESERVE;                              // 2458m

  /* ------------------------------------------------------------------- DSL */
  const oth = o => [0, 1, 2].filter(x => x !== o);
  const opp = x => (x === 0 ? 2 : 0);   // chỉ dùng cho x ∈ {0,2}

  /** segment trống */
  const brt = () => [{ r1: null, r2: null, tag: 'breath' }];

  /** 1 vật cản đơn, row 1 (y-8) hoặc 2 (y+8). Hàng còn 2 làn mở -> xếp dày được. */
  const sg = (l, row) => [row === 2
    ? { r1: null, r2: { block: [l] }, tag: 'single' }
    : { r1: { block: [l] }, r2: null, tag: 'single' }];

  /** weave: 2 vật cản đơn ở 2 hàng cách 16m. Mỗi hàng còn 2 làn mở -> an toàn. */
  const wv = (a, b) => [{ r1: { block: [a] }, r2: { block: [b] }, tag: 'weave' }];

  /** gate: chặn 2 làn, chỉ mở `open`. LUÔN row1 + row2 trống => hàng sau cách 32m. */
  const gt = open => [{ r1: { block: oth(open) }, r2: null, tag: 'gate' }];

  /** gate rồi chặn chính làn vừa mở ở hàng sau (ép dịch đúng 1 làn trong 16m). */
  const gsx = open => [{ r1: { block: oth(open) }, r2: { block: [open] }, tag: 'gate+forced' }];

  /** oil: chiếm 2 segment, segment sau bỏ trống => runway 64m (1.28s @50m/s). */
  const oil = l => [
    { r1: { oil: l }, r2: null, tag: 'oil' },
    { r1: null, r2: null, tag: 'oil-runway' }
  ];

  /* --- Item set pieces: giữ nguyên 3 context gốc, canh theo lattice --- */

  /** cross: gate ép về làn X -> 32m sau item ở làn đối diện -> 16m sau chặn lại làn item
   *  -> tail chặn chính làn X (làn vừa được ưu ái) để không tạo hành lang an toàn.
   *  X phải ∈ {0,2} để "làn đối diện" là 2 làn cách. */
  const itCross = (kind, X) => {
    const L = opp(X);
    return [
      { r1: { block: oth(X) }, r2: null, tag: 'item-gate' },
      { r1: { item: kind, lane: L, ctx: 'cross' }, r2: { block: [L] }, tag: 'item' },
      { r1: { block: [X] }, r2: null, tag: 'item-tail' }
    ];
  };

  /** gauntlet: chặn làn L -> 32m sau item ở chính làn L -> 16m sau chặn lại làn L
   *  -> tail là gate mở đúng làn L, phá hành lang của 2 làn kia. */
  const itGaunt = (kind, L) => [
    { r1: { block: [L] }, r2: null, tag: 'item-guard' },
    { r1: { item: kind, lane: L, ctx: 'gauntlet' }, r2: { block: [L] }, tag: 'item' },
    { r1: { block: oth(L) }, r2: null, tag: 'item-tail' }
  ];

  /** bait: item trống trải -> 16m sau gate mở ở làn KỀ (E), buộc rời ngay
   *  -> tail chặn chính làn E. |L-E| phải = 1 để kịp trong 16m. */
  const itBait = (kind, L, E) => [
    { r1: { item: kind, lane: L, ctx: 'bait' }, r2: { block: oth(E) }, tag: 'item' },
    { r1: { block: [E] }, r2: null, tag: 'item-tail' }
  ];

  const seq = (...xs) => [].concat.apply([], xs);

  /* ------------------------------------------------- COMPILE (auto-fix pass)
     Người thiết kế chỉ cần viết trật tự khối mong muốn (beats). Trình biên dịch
     đi qua từng segment và tự sửa để KHÔNG THỂ ghép lỗi:
       · sắp vượt MAX_DENSE_RUN  -> chèn segment nghỉ
       · một làn sắp trống quá lâu -> chèn vật cản đơn đúng làn đó
       · thiếu độ dài -> pad bằng nghỉ / khối nhẹ
       · luôn kết thúc bằng segment nghỉ để chỗ nối phase an toàn
     Nhờ vậy mọi biến thể đều dài bằng nhau và tự thoả ràng buộc.               */
  const DENSE_LIMIT = MAX_DENSE_RUN - 1;   // chèn nghỉ trước khi chạm ngưỡng
  const FREE_LIMIT = MAX_FREE_STREAK - 1;  // phá hành lang trước khi chạm ngưỡng

  function blockedLanesOf(seg) {
    const b = [false, false, false];
    [seg.r1, seg.r2].forEach(r => {
      if (!r) return;
      if (r.oil !== undefined) b[r.oil] = true;
      else if (r.item) { /* item không tính là chặn */ }
      else r.block.forEach(l => b[l] = true);
    });
    return b;
  }

  function compilePhase(beats, targetLen) {
    const out = [];
    /* Giả định xấu nhất về phase trước: segment cuối của phase trước luôn là
       segment nghỉ, nên khi vào phase này mọi làn đã trống 1 segment.
       Nhờ vậy ràng buộc streak vẫn đúng khi ghép bất kỳ biến thể nào. */
    const streak = [1, 1, 1];
    let dense = 0;
    let bi = 0;

    const push = seg => {
      out.push(seg);
      const b = blockedLanesOf(seg);
      const solid = b[0] || b[1] || b[2];
      dense = solid ? dense + 1 : 0;
      for (let l = 0; l < 3; l++) streak[l] = b[l] ? 0 : streak[l] + 1;
    };
    const pushAll = segs => segs.forEach(push);

    // mô phỏng: đặt khối này thì dense chạm bao nhiêu?
    const densePeakIfPlaced = blk => {
      let d = dense, peak = d;
      blk.forEach(seg => {
        const b = blockedLanesOf(seg);
        d = (b[0] || b[1] || b[2]) ? d + 1 : 0;
        if (d > peak) peak = d;
      });
      return peak;
    };
    // mô phỏng: đặt khối này thì làn nào trống lâu nhất và bao nhiêu?
    const streakPeakIfPlaced = blk => {
      const s = streak.slice();
      let peak = Math.max(s[0], s[1], s[2]);
      blk.forEach(seg => {
        const b = blockedLanesOf(seg);
        for (let l = 0; l < 3; l++) {
          s[l] = b[l] ? 0 : s[l] + 1;
          if (s[l] > peak) peak = s[l];
        }
      });
      return peak;
    };

    /* Chừa 2 slot cuối cho đuôi chuẩn hoá: [phase-reset, breath] */
    const TAIL = 2;
    const body = targetLen - TAIL;
    const remaining = () => body - out.length;

    let guard = 0;
    while (out.length < body && guard++ < targetLen * 8) {
      // 1) làn sắp thành hành lang an toàn -> chặn ngay làn đó
      const starved = [0, 1, 2].filter(l => streak[l] >= FREE_LIMIT)
        .sort((a, b) => streak[b] - streak[a]);
      if (starved.length && dense < DENSE_LIMIT) { pushAll(sg(starved[0], 1)); continue; }

      // 2) chuỗi dày sắp tràn -> nghỉ
      //    (đuôi chuẩn hoá thêm 1 segment dày nữa, nên trừ 1 vào ngưỡng ở sát cuối)
      const limit = remaining() <= 1 ? DENSE_LIMIT - 1 : DENSE_LIMIT;
      if (dense >= limit) { pushAll(brt()); continue; }

      // 3) khối designer, chỉ đặt khi không phá ràng buộc và còn đủ chỗ
      if (bi < beats.length) {
        const blk = beats[bi];
        if (blk.length > remaining()) { bi = beats.length; continue; }
        if (densePeakIfPlaced(blk) > MAX_DENSE_RUN) { pushAll(brt()); continue; }
        if (streakPeakIfPlaced(blk) > MAX_FREE_STREAK) {
          // chèn vật cản ở làn trống lâu nhất trước khi vào khối
          const l = [0, 1, 2].sort((a, b) => streak[b] - streak[a])[0];
          pushAll(sg(l, 1));
          continue;
        }
        bi++; pushAll(blk); continue;
      }

      // 4) pad: ưu tiên chặn làn trống lâu nhất, xen kẽ nghỉ
      const l = [0, 1, 2].sort((a, b) => streak[b] - streak[a])[0];
      if (dense === 0 || streak[l] >= 2) pushAll(sg(l, 1));
      else pushAll(brt());
    }
    /* 5) Đuôi chuẩn hoá — đưa phase về trạng thái trung tính đã biết.
          phase-reset: hàng r1 chặn L+C, hàng r2 chặn R => reset streak cả 3 làn.
          Mỗi hàng vẫn còn ≥1 làn mở, giữa hai hàng chỉ cần dịch 1 làn nên né được.
          Rồi 1 segment nghỉ => mọi biến thể kết thúc với streak = [1,1,1],
          nên ghép A/B/C bất kỳ cũng không tạo hành lang an toàn ở chỗ nối. */
    push({ r1: { block: [0, 1] }, r2: { block: [2] }, tag: 'phase-reset' });
    push({ r1: null, r2: null, tag: 'breath' });
    out.leftover = beats.length - bi;
    out.denseAtTail = dense;
    return out;
  }

  /* Beats do designer viết: mảng các khối. Compile sẽ chèn nghỉ / phá hành lang. */
  const PHASE_SPEC = [
    {
      key: 'P1', label: 'Warmup', len: 8,
      beats: {
        A: [brt(), sg(1, 1), wv(0, 2), sg(2, 1), wv(1, 0)],
        B: [wv(2, 0), sg(1, 1), sg(0, 2), wv(1, 2)],
        C: [sg(0, 1), gt(1), sg(2, 2), wv(0, 1)]
      }
    },
    {
      /* P2 chứa 1 booster (đầu phase) + 1 gift (giữa phase).
         Gift dùng context 'bait': trống trải rồi gate chặn ngay sau, nên vào
         lấy dễ hơn 'gauntlet' (bị kẹp cả hai đầu cùng làn). */
      /* P2 = 10–30s. distAtTime(10)=250m, distAtTime(30)=950m ⇒ 700m ≈ 22 segment.
         Booster đặt đầu phase, GIFT đặt ĐÚNG GIỮA phase:
         giữa P2 theo thời gian là giây 20 ⇒ distAtTime(20)=575m ⇒ segment 18,
         tức P2-index 10. Các khối trước gift được xếp để cộng lại đúng 10 segment. */
      key: 'P2', label: 'Cruise + Trap', len: 22,
      beats: {
        //   1        1          3 (idx 2,3,4)      1       1        1      2 (idx 8,9)
        A: [gt(1), wv(0, 2), itCross('booster', 0), gt(2), wv(2, 1), gsx(1), oil(1),
            itBait('gift', 0, 1),                            // idx 10,11 ← giữa P2
            gt(1), wv(0, 2), gt(2), oil(0)],
        B: [wv(1, 0), gt(2), itGaunt('booster', 2), wv(2, 1), gt(1), gsx(2), oil(2),
            itBait('gift', 2, 1),
            gt(0), wv(1, 2), gt(1), oil(1), gt(2)],
        C: [gt(2), wv(1, 0), itBait('booster', 0, 1), gsx(1), wv(1, 2), gt(1), gsx(0), oil(0),
            itBait('gift', 2, 1),
            gt(1), wv(2, 0), gt(0), oil(2)]
      }
    },
    {
      /* P3 chỉ còn 1 booster (đặt sớm trong phase để còn dùng được).
         Gift đã chuyển sang P2. */
      /* P3 = 30–60s ⇒ 950–2300m = 1350m ≈ 42 segment, cộng dự phòng boost
         (BOOST_RESERVE ≈ 158m ≈ 5 segment) và một ít biên ⇒ 50. */
      key: 'P3', label: 'Intense + Peak', len: 50,
      beats: {
        A: [gsx(1), wv(0, 2), gt(0), wv(1, 2), oil(1),
            gsx(2), wv(1, 0), itCross('booster', 0),
            gsx(1), wv(2, 1), gt(2), wv(0, 1), oil(0),
            gsx(2), wv(0, 2), gt(1), gsx(1), gt(0), wv(1, 2), gsx(2), wv(2, 0), oil(2),
            gsx(0), wv(2, 0), gt(2), wv(1, 0), oil(1),
            gsx(2), wv(0, 1), gt(0), wv(2, 1)],
        B: [gt(1), wv(2, 0), gsx(0), wv(1, 2), oil(2),
            gsx(1), gt(2), itGaunt('booster', 2),
            gsx(2), wv(1, 0), gt(0), wv(2, 1), oil(0),
            gsx(0), wv(1, 2), gt(1), gsx(2), gt(2), wv(0, 1), gsx(1), wv(2, 0), oil(1),
            gsx(1), wv(0, 2), gt(1), gsx(0), oil(2),
            gt(1), wv(2, 1), gsx(0), wv(0, 2), gsx(2)],
        C: [gsx(0), wv(1, 2), gt(2), wv(0, 1), oil(1),
            gsx(1), gt(0), itBait('booster', 0, 1),
            gsx(2), wv(0, 2), gt(1), wv(2, 0), oil(0),
            gsx(1), gt(2), wv(1, 0), gsx(0), wv(2, 1), gt(0), gsx(2), wv(0, 2), oil(2),
            gsx(0), wv(2, 0), gt(1), wv(0, 2), oil(1),
            gsx(2), gt(1), wv(1, 2), gt(0), gsx(1)]
      }
    }
  ];

  /* Biên dịch thành thư viện segment cuối cùng */
  const COMPILED = {};
  PHASE_SPEC.forEach(spec => {
    COMPILED[spec.key] = {};
    ['A', 'B', 'C'].forEach(k => {
      COMPILED[spec.key][k] = compilePhase(spec.beats[k], spec.len);
    });
  });

  const PHASE_DEF = PHASE_SPEC.map(spec => ({
    key: spec.key, label: spec.label, len: spec.len, lib: COMPILED[spec.key]
  }));

  /* ------------------------------------------------------------- BUILD MAP */
  /* id vật cản normal theo công thức cố định -> tái lập 100% */
  const pickId = (seg, row, lane) => NORMAL_POOL[(seg * 7 + row * 3 + lane) % 3];

  function buildMap(sel) {
    const parts = PHASE_DEF.map(pd => pd.lib[sel[pd.key]]);
    const abstract = seq.apply(null, parts);

    const bounds = {};
    let acc = 0;
    PHASE_DEF.forEach((pd, i) => {
      bounds[pd.key] = [acc, acc + parts[i].length];
      acc += parts[i].length;
    });

    const segs = [], items = [];
    abstract.forEach((a, i) => {
      const dist = i * SEG_H;
      const obstacles = [];
      const names = [];

      [[a.r1, 1], [a.r2, 2]].forEach(function (pair) {
        const r = pair[0], rowNo = pair[1];
        if (!r) return;
        const ly = ROW_LOCAL_Y[rowNo];
        if (r.oil !== undefined) {
          obstacles.push({ t: 'oil', id: 'oil', x: LANE_XS[r.oil], y: ly, lane: r.oil, row: rowNo });
          names.push('oil' + 'LCR'[r.oil]);
        } else if (r.item) {
          obstacles.push({ t: r.item, id: r.item, x: LANE_XS[r.lane], y: ly, lane: r.lane, row: rowNo, ctx: r.ctx });
          names.push((r.item === 'booster' ? '⚡' : '🎁') + 'LCR'[r.lane]);
        } else {
          r.block.forEach(l => obstacles.push({
            t: 'normal', id: pickId(i, rowNo, l), x: LANE_XS[l], y: ly, lane: l, row: rowNo
          }));
          names.push(r.block.length === 2
            ? 'gate' + 'LCR'[[0, 1, 2].find(l => r.block.indexOf(l) < 0)]
            : 's' + 'LCR'[r.block[0]]);
        }
      });

      const phase = i < bounds.P1[1] ? 'P1' : i < bounds.P2[1] ? 'P2' : 'P3';
      segs.push({
        idx: i, dist, time: timeAtDist(dist), phase,
        tag: a.tag || 'seg',
        pname: names.length ? names.join(' / ') : 'breath',
        obstacles
      });

      obstacles.filter(o => o.t === 'booster' || o.t === 'gift').forEach(o => {
        const wy = dist + SEG_H / 2 + o.y;
        items.push({ type: o.t, ctx: o.ctx, seg: i, lane: o.lane, dist: wy, time: timeAtDist(wy) });
      });
    });

    return { segs, items, bounds, sel: { P1: sel.P1, P2: sel.P2, P3: sel.P3 } };
  }

  /* Gom vật cản thành hàng theo world y */
  function rowsOf(segs) {
    const m = new Map();
    segs.forEach(s => s.obstacles.forEach(o => {
      const wy = s.dist + SEG_H / 2 + o.y;
      if (!m.has(wy)) m.set(wy, { y: wy, time: timeAtDist(wy), lanes: [], items: [] });
      const r = m.get(wy);
      if (o.t === 'booster' || o.t === 'gift') r.items.push(o);
      else r.lanes.push(o.lane);
    }));
    return Array.from(m.values()).sort((a, b) => a.y - b.y);
  }

  const openLanes = r => [0, 1, 2].filter(l => r.lanes.indexOf(l) < 0);
  const minHop = (from, to) => {
    let best = 9;
    from.forEach(a => to.forEach(b => { best = Math.min(best, Math.abs(a - b)); }));
    return best;
  };

  /* -------------------------------------------------------------- VALIDATE */
  function validate(M) {
    const segs = M.segs, items = M.items;
    const rows = rowsOf(segs);
    const obsRows = rows.filter(r => r.lanes.length > 0);
    const out = [];

    // 1. lattice: hàng cách nhau bội số của ROW_GAP và >= ROW_GAP
    const offGrid = [];
    for (let i = 1; i < obsRows.length; i++) {
      const g = obsRows[i].y - obsRows[i - 1].y;
      if (g < ROW_GAP - 0.01 || Math.abs(g % ROW_GAP) > 0.01) offGrid.push(obsRows[i].y | 0);
    }
    out.push([!offGrid.length, 'Hàng đúng lattice ' + ROW_GAP + 'm',
      offGrid.length ? 'lệch @' + offGrid.slice(0, 3).join(',') : obsRows.length + ' hàng OK']);

    // 2. hàng gần nhất vẫn đủ thời gian phản xạ 1 làn
    let minDt = Infinity, minAt = 0;
    for (let i = 1; i < obsRows.length; i++) {
      const dt = (obsRows[i].y - obsRows[i - 1].y) / speedAt(obsRows[i].time);
      if (dt < minDt) { minDt = dt; minAt = obsRows[i].time; }
    }
    out.push([minDt >= LANE_TIME * REACT_MARGIN, 'Reaction ≥ ' + REACT_MARGIN + '× thời gian đổi làn',
      'min ' + minDt.toFixed(2) + 's @' + minAt.toFixed(0) + 's · cần ' + (LANE_TIME * REACT_MARGIN).toFixed(2) + 's']);

    // 3. không bịt kín 3 làn
    const full = rows.filter(r => new Set(r.lanes).size >= 3).map(r => r.y | 0);
    out.push([!full.length, 'Luôn còn ≥1 làn mở',
      full.length ? 'bịt kín @' + full.slice(0, 3).join(',') : 'OK']);

    // 4. QUAN TRỌNG: mọi hàng đều né được từ hàng trước (số làn phải dịch vs thời gian có)
    const unreach = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], cur = rows[i];
      const from = openLanes(prev), to = openLanes(cur);
      if (!to.length) { unreach.push('@' + (cur.y | 0) + ' kín'); continue; }
      const dt = (cur.y - prev.y) / speedAt(cur.time);
      const hop = minHop(from, to);
      if (hop * LANE_TIME > dt + 0.02) {
        unreach.push('@' + (cur.y | 0) + ' cần ' + (hop * LANE_TIME).toFixed(2) + 's > ' + dt.toFixed(2) + 's');
      }
    }
    out.push([!unreach.length, 'Mọi hàng đều né được',
      unreach.length ? unreach.slice(0, 2).join(' · ') : 'OK']);

    // 5. runway sau oil >= SLIP_DUR
    const badOil = [];
    segs.forEach(s => {
      const o = s.obstacles.find(x => x.t === 'oil');
      if (!o) return;
      const oy = s.dist + SEG_H / 2 + o.y;
      const nx = obsRows.find(r => r.y > oy + 0.1);
      if (!nx) return;
      const dt = (nx.y - oy) / speedAt(s.time);
      if (dt < SLIP_DUR) badOil.push('oil@' + (oy | 0) + '(' + dt.toFixed(2) + 's)');
    });
    out.push([!badOil.length, 'Runway sau Oil ≥ ' + SLIP_DUR + 's',
      badOil.length ? badOil.slice(0, 3).join(' ') : 'OK']);

    // 6. item lấy được từ hàng trước
    const itemHard = [];
    items.forEach(it => {
      const cur = rows.find(r => Math.abs(r.y - it.dist) < 0.01);
      if (!cur) return;
      const idx = rows.indexOf(cur);
      if (idx <= 0) return;
      const prev = rows[idx - 1];
      const from = openLanes(prev);
      const dt = (cur.y - prev.y) / speedAt(cur.time);
      const hop = Math.min.apply(null, from.map(a => Math.abs(a - it.lane)));
      if (hop * LANE_TIME > dt + 0.02) {
        itemHard.push(it.type + '@' + (it.dist | 0) + ' cần ' + (hop * LANE_TIME).toFixed(2) + 's > ' + dt.toFixed(2) + 's');
      }
    });
    out.push([!itemHard.length, 'Item nằm trong tầm đổi làn',
      itemHard.length ? itemHard.join(' · ') : 'OK']);

    // 7. làn trống liên tiếp (chống hành lang an toàn)
    const streak = [0, 0, 0]; let mxStreak = 0;
    segs.forEach(s => {
      const b = [false, false, false];
      s.obstacles.filter(o => o.t !== 'booster' && o.t !== 'gift').forEach(o => b[o.lane] = true);
      for (let l = 0; l < 3; l++) { streak[l] = b[l] ? 0 : streak[l] + 1; mxStreak = Math.max(mxStreak, streak[l]); }
    });
    out.push([mxStreak <= MAX_FREE_STREAK, 'Làn trống liên tiếp ≤ ' + MAX_FREE_STREAK + ' segment',
      'dài nhất ' + mxStreak]);

    // 8. nhịp thở: chuỗi segment có vật cản
    let run = 0, mxRun = 0;
    segs.forEach(s => { run = s.obstacles.length ? run + 1 : 0; mxRun = Math.max(mxRun, run); });
    out.push([mxRun <= MAX_DENSE_RUN, 'Chuỗi segment có vật cản ≤ ' + MAX_DENSE_RUN, 'dài nhất ' + mxRun]);

    // 9. mật độ tăng dần
    const dens = ['P1', 'P2', 'P3'].map(p => {
      const g = segs.filter(s => s.phase === p);
      const n = g.reduce((a, s) => a + s.obstacles.filter(o => o.t !== 'booster' && o.t !== 'gift').length, 0);
      return g.length ? n / g.length : 0;
    });
    out.push([dens[0] < dens[1] && dens[1] < dens[2], 'Mật độ tăng đều P1<P2<P3',
      dens.map(d => d.toFixed(2)).join(' → ') + ' obs/seg']);

    // 10. đủ 4 loại vật cản
    const ids = new Set();
    segs.forEach(s => s.obstacles.filter(o => o.t === 'normal').forEach(o => ids.add(o.id)));
    const hasOil = segs.some(s => s.obstacles.some(o => o.t === 'oil'));
    out.push([ids.size === 3 && hasOil, 'Đủ 4 loại vật cản',
      Array.from(ids).join(' ') + (hasOil ? ' + oil' : ' (thiếu oil)')]);

    // 11. đúng số item
    const nb = items.filter(x => x.type === 'booster').length;
    const ng = items.filter(x => x.type === 'gift').length;
    out.push([nb === N_BOOST && ng === N_GIFT, N_BOOST + ' booster + ' + N_GIFT + ' gift', nb + 'B + ' + ng + 'G']);

    // 12. item cách nhau
    const its = items.slice().sort((a, b) => a.dist - b.dist);
    const near = [];
    for (let i = 1; i < its.length; i++) {
      if (its[i].dist - its[i - 1].dist < ITEM_MIN_SPACING) near.push((its[i - 1].dist | 0) + '↔' + (its[i].dist | 0));
    }
    out.push([!near.length, 'Item cách nhau ≥ ' + ITEM_MIN_SPACING + 'm', near.length ? near.join(' ') : 'OK']);

    // 13. item trong cửa sổ thời gian
    const bOk = items.filter(x => x.type === 'booster').every(x => x.time >= BOOST_WINDOW[0] && x.time <= BOOST_WINDOW[1]);
    const gOk = items.filter(x => x.type === 'gift').every(x => x.time >= GIFT_WINDOW[0] && x.time <= GIFT_WINDOW[1]);
    out.push([bOk && gOk, 'Item trong cửa sổ thời gian',
      items.map(x => (x.type === 'booster' ? '⚡' : '🎁') + x.time.toFixed(0) + 's').join(' ')]);

    /* 13b. Item phải nằm trong quãng đường người chơi THỰC TẾ đi được.
       Luật hình học ở trên chỉ kiểm "có kịp đổi làn tới item hay không", nên đã
       để lọt trường hợp quà nằm ở 93% quãng đường: đúng về hình học nhưng người
       chơi ăn 3 va chạm là không bao giờ tới. Ở đây mô phỏng quãng đường còn lại
       sau HIT_BUDGET va chạm (không tính boost) và yêu cầu item nằm trong đó. */
    const reachAfterHits = (nHit) => {
      let t = 0, d = 0, slow = 0;
      const dt = 1 / 60;
      const hitTimes = [];
      for (let i = 0; i < nHit; i++) hitTimes.push(12 + i * (42 / Math.max(1, nHit)));
      let left = nHit;
      while (t < GAME_TIME) {
        if (left > 0 && t >= hitTimes[nHit - left]) { slow = COLLIDE_DUR; left--; }
        let v = speedAt(t);
        if (slow > 0) v *= COLLIDE_MULT;
        d += v * dt; t += dt;
        slow = Math.max(0, slow - dt);
      }
      return d;
    };
    const budgetDist = reachAfterHits(HIT_BUDGET);
    const tooFar = items.filter(x => x.dist > budgetDist);
    out.push([!tooFar.length, 'Item nằm trong tầm với sau ' + HIT_BUDGET + ' va chạm',
      tooFar.length
        ? tooFar.map(x => x.type + '@' + (x.dist | 0) + 'm > ' + (budgetDist | 0) + 'm').join(' ')
        : 'xa nhất ' + (Math.max.apply(null, items.map(x => x.dist)) | 0) + 'm / ' + (budgetDist | 0) + 'm']);

    // 14. phủ hết quãng đường
    const total = segs.length * SEG_H;
    out.push([total >= NEED_DIST, 'Map phủ 60s + dự phòng boost', total + 'm / cần ' + (NEED_DIST | 0) + 'm']);

    // 15. ngân sách boost
    const budget = N_BOOST * BOOST_DUR / GAME_TIME;
    out.push([budget <= 0.20, 'Ngân sách boost ≤ 20%', Math.round(budget * 100) + '%']);

    return out;
  }

  /* ------------------------------------------------------------------ LINT */
  /* Kiểm tra thư viện biến thể TRƯỚC khi ghép. Ba nhóm:
       (a) tính hoán vị được: 3 biến thể cùng độ dài, cùng kết thúc bằng segment trống
       (b) vật lý cục bộ: mọi cặp hàng liền nhau trong biến thể đều né được,
           đo ở tốc độ TỆ NHẤT mà biến thể đó có thể gặp (nếu đứng cuối map)
       (c) đủ item theo đặc tả phase                                            */
  function lintLibrary() {
    const errs = [];

    // tốc độ tệ nhất một phase có thể gặp: P1 luôn ở đầu, P2 ở giữa, P3 tới cuối
    const worstSpeed = { P1: speedAt(10), P2: speedAt(30), P3: speedAt(GAME_TIME) };
    /* P2 giữ 1 booster + 1 gift (gift ở giữa phase để còn dư địa quãng đường).
       P3 chỉ còn 1 booster. */
    const wantItems = { P1: {}, P2: { booster: 1, gift: 1 }, P3: { booster: 1 } };

    PHASE_DEF.forEach(pd => {
      const lens = ['A', 'B', 'C'].map(k => pd.lib[k].length);
      if (new Set(lens).size !== 1) {
        errs.push(pd.key + ': số segment 3 biến thể lệch nhau (' + lens.join('/') + ')');
      }
      if (lens[0] !== pd.len) {
        errs.push(pd.key + ': compile ra ' + lens[0] + ' segment, đặc tả ' + pd.len);
      }

      ['A', 'B', 'C'].forEach(k => {
        const lib = pd.lib[k];
        const tail = lib[lib.length - 1];
        if (tail && (tail.r1 || tail.r2)) {
          errs.push(pd.key + k + ': segment cuối phải trống (an toàn chỗ nối phase)');
        }
        if (lib.leftover > 0) {
          errs.push(pd.key + k + ': ' + lib.leftover + ' khối bị cắt vì thiếu chỗ — tăng len hoặc bớt beats');
        }

        // dựng danh sách hàng cục bộ rồi kiểm tra khả năng né ở tốc độ tệ nhất
        const rows = [];
        lib.forEach((s, i) => {
          [[s.r1, 1], [s.r2, 2]].forEach(pair => {
            const r = pair[0], rowNo = pair[1];
            if (!r) return;
            const y = i * SEG_H + SEG_H / 2 + ROW_LOCAL_Y[rowNo];
            if (r.oil !== undefined) rows.push({ y, seg: i, blocked: [r.oil] });
            else if (r.item) rows.push({ y, seg: i, blocked: [] });
            else rows.push({ y, seg: i, blocked: r.block.slice() });
          });
        });
        const solid = rows.filter(r => r.blocked.length > 0);
        const v = worstSpeed[pd.key];
        for (let i = 1; i < solid.length; i++) {
          const a = solid[i - 1], b = solid[i];
          const gap = b.y - a.y;
          if (gap < ROW_GAP - 0.01 || Math.abs(gap % ROW_GAP) > 0.01) {
            errs.push(pd.key + k + ' seg' + b.seg + ': hàng lệch lattice (' + gap + 'm)');
            continue;
          }
          const from = [0, 1, 2].filter(l => a.blocked.indexOf(l) < 0);
          const to = [0, 1, 2].filter(l => b.blocked.indexOf(l) < 0);
          if (!to.length) { errs.push(pd.key + k + ' seg' + b.seg + ': bịt kín 3 làn'); continue; }
          const hop = minHop(from, to);
          const dt = gap / v;
          if (hop * LANE_TIME > dt + 0.02) {
            errs.push(pd.key + k + ' seg' + a.seg + '→' + b.seg + ': cần dịch ' + hop +
              ' làn trong ' + dt.toFixed(2) + 's (chỉ đủ ' + Math.floor(dt / LANE_TIME) + ') @' + v.toFixed(0) + 'm/s');
          }
        }

        // item đúng đặc tả
        const got = {};
        lib.forEach(s => [s.r1, s.r2].forEach(r => {
          if (r && r.item) got[r.item] = (got[r.item] || 0) + 1;
        }));
        const want = wantItems[pd.key];
        Object.keys(want).forEach(t => {
          if ((got[t] || 0) !== want[t]) {
            errs.push(pd.key + k + ': cần ' + want[t] + ' ' + t + ', có ' + (got[t] || 0));
          }
        });
        Object.keys(got).forEach(t => {
          if (!want[t]) errs.push(pd.key + k + ': không nên có ' + t);
        });
      });
    });

    /* Ranh giới phase phải khớp mốc thời gian thiết kế (P1 0–10s, P2 10–30s, P3 30–60s).
       Trước đây tăng len của P2 để chứa thêm item đã làm P2 tràn sang 36.5s,
       kéo P3 lệch theo — luật này chặn việc đó. */
    const WANT = [{ key: 'P1', t: 10 }, { key: 'P2', t: 30 }];
    let acc = 0;
    PHASE_DEF.forEach(pd => {
      acc += pd.len;
      const w = WANT.find(x => x.key === pd.key);
      if (!w) return;
      const tEnd = timeAtDist(acc * SEG_H);
      if (Math.abs(tEnd - w.t) > 1.5) {
        errs.push(pd.key + ' kết thúc ở giây ' + tEnd.toFixed(1) + ', thiết kế ' + w.t +
          's — sửa len (cần ~' + Math.round(distAtTime(w.t) / SEG_H - (acc - pd.len)) + ' segment)');
      }
    });

    /* Gift phải nằm giữa P2 (theo thời gian), không dồn về đầu hay cuối phase */
    ['A', 'B', 'C'].forEach(k => {
      const M = buildMap({ P1: k, P2: k, P3: k });
      const g = M.items.find(i => i.type === 'gift');
      if (!g) { errs.push('P2' + k + ': không có gift'); return; }
      const frac = (g.time - 10) / 20;                 // 0 = đầu P2, 1 = cuối P2
      if (frac < 0.3 || frac > 0.7) {
        errs.push('P2' + k + ': gift ở ' + Math.round(frac * 100) + '% của P2 (giây ' +
          g.time.toFixed(1) + ') — cần 30–70% để coi là "giữa phase"');
      }
    });

    return errs;
  }

  /* Chạy toàn bộ 27 tổ hợp */
  function testAllCombos() {
    const K = ['A', 'B', 'C'];
    const results = [];
    K.forEach(a => K.forEach(b => K.forEach(c => {
      const sel = { P1: a, P2: b, P3: c };
      const M = buildMap(sel);
      const v = validate(M);
      const failed = v.filter(x => !x[0]);
      results.push({
        combo: a + '-' + b + '-' + c,
        pass: failed.length === 0,
        failed: failed.map(x => x[1] + ' [' + x[2] + ']'),
        segs: M.segs.length,
        items: M.items.map(it => it.type + '@' + (it.dist | 0) + 'm/' + it.time.toFixed(1) + 's/' + it.ctx)
      });
    })));
    return results;
  }

  /* ----------------------------------------------------------------- EXPORT */
  /* Chỉ export những gì index.html / export_unity.js / check_levels.js thật sự
     dùng. Các hằng khác (ROW_LOCAL_Y, BOOST_WINDOW, GIFT_WINDOW, HIT_BUDGET,
     COMPILED) chỉ phục vụ nội bộ module nên không đưa ra ngoài. */
  return {
    GAME_TIME, SEG_H, ROAD_W, LANE_XS, LANE_W, ROW_GAP,
    SPEED_LEVELS, OBS_MAP, NORMAL_POOL,
    CAR_W, CAR_H, LATERAL_V, LANE_TIME, CAR_LIMIT_X,
    SLIP_DUR, COLLIDE_DUR, COLLIDE_MULT,
    BOOST_DUR, BOOST_MULT, BOOST_SCORE, GIFT_SCORE, N_BOOST, N_GIFT,
    ITEM_W, ITEM_H,
    BASE_DIST, BOOST_RESERVE, NEED_DIST,
    speedAt, distAtTime, timeAtDist,
    PHASE_SPEC, PHASE_DEF,
    buildMap, rowsOf, validate, lintLibrary, testAllCombos
  };
});
