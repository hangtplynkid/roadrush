# Road Rush — Level Design

Bộ công cụ thiết kế và kiểm chứng map cho game runner 3 làn, 60 giây. Sinh
`road_path_patterns.json` cho Unity dùng trực tiếp.

Mọi ràng buộc trong tool đều suy ra từ tốc độ thật của game, và được kiểm bằng máy
trước khi xuất file. Exporter không ghi file nếu có lỗi (exit code 1).

---

## Chạy

```bash
node check_levels.js             # lint thư viện + kiểm 27 tổ hợp map
node export_unity.js --check     # kiểm pool + 1024 cặp + 500 seed, không ghi
node export_unity.js             # ghi road_path_patterns.json (backup .bak)
node export_unity.js --items     # ghi thêm items.json
node export_unity.js --oil-early # phương án B cho oil (xem mục Oil)
```

Mở `index.html` để xem chỉ số và chơi thử. Không cần server.

---

## File

| File | Vai trò |
|---|---|
| `level_design.js` | Config, DSL, biến thể A/B/C, compiler, validator 17 rule |
| `unity_patterns.js` | Pattern pool 32 mẫu, luật R1–R4, mô phỏng pipeline Unity |
| `export_unity.js` | Sinh `road_path_patterns.json` + `items.json` |
| `check_levels.js` | Lint thư viện + kiểm 27 tổ hợp |
| `index.html` | Bảng chỉ số + chơi thử (dùng chung 2 module trên) |
| `road_path_patterns.json` | **File Unity đọc** — do exporter ghi ra |
| `items.json` | Booster/gift theo `distanceY` (sinh bởi `--items`) |
| `app.ts`, `init_data.json` | Server + config game |

Hai module dùng UMD nên browser và node chung một nguồn sự thật.

### Giá trị phải đồng bộ 4 chỗ

`activeDuration` và `speedMultiplier` của `collided` / `slipping` phải khớp tuyệt đối
giữa `level_design.js`, `index.html`, `app.ts` (`CarStates`), `init_data.json`
(`carState`). Server dùng chúng mô phỏng lại quãng đường; lệch là anti-cheat trả
`distance > allowedMaxDistance` → "Xác thực khoảng cách thất bại".

Hiện: `collided = 0.6s × 0.55`, `slipping = 1.0s`.

Ramp hồi phục `0.5s` **không** cần đồng bộ — nó làm client chậm hơn server, mà server
chỉ kiểm cận trên.

---

## Thông số game

### Đường và xe

| Thông số | Giá trị |
|---|---|
| Thời lượng | 60s |
| Làn | 3, tâm tại x = −3.5 / 0 / +3.5 |
| Chiều rộng đường | 16m |
| Biên di chuyển | ±5.25m (`CarLimitX`) |
| Segment | 32m × 16m |
| Xe | 2.49 × 3.965, BoxCollider2D offset 0 |
| Tốc độ ngang | 14 m/s ⇒ đổi 1 làn = **0.25s** |

### Tốc độ theo thời gian

Nội suy tuyến tính giữa các mốc.

| Giây | Tốc độ | Quãng đường tới đó |
|---|---|---|
| 0 | 20 m/s | 0m |
| 10 | 30 m/s | 250m |
| 30 | 40 m/s | 950m |
| 60 | 50 m/s | 2300m |

Chạy sạch 60s = **2300m**. Cộng dự phòng boost 158m ⇒ map phải phủ ≥ **2458m**.

### Vật cản

| ID | Loại | Collider | Hiệu ứng |
|---|---|---|---|
| `cone` | normal | 1.9 × 2.41 | `collided` 0.6s ×0.55, rồi hồi dần 0.5s |
| `tire` | normal | 3.3 × 2.57 | như trên |
| `fence` | normal | 3.51 × 2.64 | như trên |
| `oil` | oil | 3.28 × 2.33 | `slipping` 1.0s, mất lái |

Một va chạm mất khoảng 9–11m (tuỳ tốc độ). Tổng thời gian xe không chạy đủ tốc là
`0.6 + 0.5 = 1.1s`.

### Hồi phục dần

Hết `collided`, tốc độ bò từ `0.55×` lên `1.0×` trong `RECOVER_DUR = 0.5s`:

```js
v *= COLLIDE_MULT + (1 - COLLIDE_MULT) * (1 - recover/RECOVER_DUR)
```

Góc phải canvas hiện `💥 0.4s · 55%` khi đang bị phạt, `↗ hồi 0.3s · 78%` khi đang hồi.

### Đếm va chạm khi nhiều vật cản cùng hàng

Hai làn kề cách 3.5m, nhưng nửa tổng bề rộng xe + fence là 3.0m — xe ở khoảng giữa
hai làn sẽ overlap **cả hai** collider. Hình học collider không đổi (phải khớp Unity);
chỉ cách **đếm** khác. Trong mỗi hàng (cùng world Y):

- vật cản xuyên **sâu nhất** theo trục X luôn tính 1 va chạm
- vật cản còn lại chỉ tính thêm nếu xuyên `≥ HIT_DEPTH_MIN = 0.5m`

| Tình huống | Độ xuyên | Số va chạm |
|---|---|---|
| Hai `fence` làn kề, xe ở giữa | 1.25m mỗi bên | 2 (nằm hẳn lên cả hai) |
| Hai `cone` làn kề, xe ở giữa | 0.45m mỗi bên | 1 (chỉ kẹp mép) |
| Đâm giữa `fence`, có `fence` làn kề | 3.0m / không chạm | 1 |
| Hai vật cản khác hàng | — | 2 |

Luật "sâu nhất luôn tính" là bắt buộc: nếu chỉ dùng ngưỡng, ca hai `cone` sẽ cho 0
va chạm — xe xuyên qua cả hai.

### Item

| Item | Số lượng | Hiệu ứng |
|---|---|---|
| Booster | 2 | tốc độ ×1.35 trong 5s + xuyên **2** vật cản |
| Gift | 1 | **voucher** — vật phẩm, không cộng điểm |

Collider 2.6 × 2.6. Ngân sách boost 2 × 5s / 60s = 17% thời lượng.

---

## Tính điểm

**Điểm = quãng đường đã đi, đơn vị mét.** Không có nguồn điểm nào khác.

```
điểm = G.dist           // chính là giá trị mét, không quy đổi
```

Phần nguyên là mét, hai số thập phân là phần dưới mét (cm). Dấu phẩy chỉ là phân cách
nghìn cho dễ đọc:

```
1,655.05   =   1655 mét  +  5 cm
```

Không có biến `score` trong game state — điểm chính là `G.dist`, chỉ định dạng lại khi
hiển thị, nên không thể lệch khỏi quãng đường.

| | Ảnh hưởng tới điểm |
|---|---|
| Booster | **gián tiếp** — ×1.35 tốc độ 5s ⇒ đi thêm ~42m |
| Xuyên vật cản khi boost | không cộng gì, chỉ tránh mất quãng đường |
| Gift | **không** — voucher là vật phẩm riêng |
| Va chạm | giảm điểm vì mất ~10m |

Chạy sạch không ăn booster = `2,300.00`. Tối đa lý thuyết = `2,458.00`.

Cách tính này khớp luôn với server: `app.ts` xác thực bằng `distance` và không có khái
niệm điểm, nên điểm hiển thị và giá trị server kiểm là cùng một đại lượng.

---

## Nguyên lý thiết kế

### Lattice 16m

Vật cản chỉ đặt ở **local y = −8 hoặc +8** trong segment 32m. Nhờ đó khoảng cách giữa
hai hàng liền nhau luôn là bội số của 16m, kể cả khi vắt qua ranh giới segment. Bắt
buộc vì Unity bốc pattern **độc lập từng segment**, không biết segment trước có gì.

### Ngân sách thời gian

Đổi một làn mất 0.25s. Số làn tối đa dịch được:

| Khoảng cách | @20 | @30 | @40 | @45 | @50 |
|---|---|---|---|---|---|
| **16m** | 0.80s · 3 làn | 0.53s · 2 làn | 0.40s · 1 làn | 0.36s · 1 làn | 0.32s · 1 làn |
| **32m** | 1.60s · 6 làn | 1.07s · 4 làn | 0.80s · 3 làn | 0.71s · 2 làn | 0.64s · 2 làn |

Ở tốc độ cuối, 16m chỉ đủ dịch **một** làn. Đây là lý do gate (chặn 2 làn, mở 1) bắt
buộc để hàng sau trống, tức hàng kế tiếp cách 32m.

**Biên an toàn `REACT_MARGIN = 1.4`.** Đủ thời gian về hình học không có nghĩa là chơi
được: 16m @50 m/s cho 0.32s, đổi làn cần 0.25s, dư 0.07s — 4 frame ở 60fps, không kịp
nhận biết. Map đòi mỗi hàng có ≥ `1.4 × 0.25 = 0.35s`. Từ đó ra tốc độ tối đa mà hàng
16m còn dùng được:

```
16 / (0.25 × 1.4) = 45.7 m/s   →  khoảng giây 47 trở đi
```

Sau mốc này mọi hàng có vật cản buộc phải cách 32m. Compiler tự lo (xem *auto-widen*).

Cũng vì vậy pattern 4–5 vật cản đặt ở y = −11/−3/+3/+11 **không dùng được**: hàng cách
nhau 6–8m, tức 0.12–0.16s ở P3.

---

## Cấu trúc map

Map = ghép 3 phase, mỗi phase 3 biến thể **A/B/C** soạn tay ⇒ **27 tổ hợp**, hoàn toàn
tất định. Không seed, không random runtime. Chọn cone/fence/tire theo công thức cố định
`(seg×7 + row×3 + lane) % 3`.

| Phase | Segment | Quãng đường | Thời gian | Nội dung |
|---|---|---|---|---|
| P1 Warmup | 8 | 0–256m | 0–10.2s | single, weave, 1 gate |
| P2 Cruise + Trap | 22 | 256–960m | 10.2–30.2s | gate + weave, oil, **1 booster + 1 gift** |
| P3 Intense + Peak | 50 | 960–2560m | 30.2–65.2s | chuỗi gate, weave tự giãn, oil, **1 booster** |

Tổng 80 segment = 2560m. Cả 27 tổ hợp đều ra 80 segment.

Độ dài phase khớp mốc thời gian: `distAtTime(30) − distAtTime(10) = 700m ÷ 32 = 22`.

### Vị trí item (tổ hợp A-A-A)

| Item | Vị trí | Giây | Làn | Context |
|---|---|---|---|---|
| Booster | 360m | 13.6s | R | cross |
| Gift | 616m | 21.2s | L | bait |
| Booster | 1352m | 39.7s | R | cross |

Gift đặt ở **giữa P2** (50% của phase) để còn nhiều dư địa quãng đường phía sau.

### DSL soạn map

Sửa `PHASE_SPEC` trong `level_design.js`:

```js
brt()                     // segment trống (breath)
sg(lane, row)             // 1 vật cản, row 1 = y−8, row 2 = y+8
wv(a, b)                  // weave: hàng 1 chặn làn a, hàng 2 chặn làn b
gt(open)                  // gate: chặn 2 làn, chỉ mở `open`, hàng sau trống
gsx(open)                 // gate rồi chặn chính làn vừa mở (ép dịch 1 làn)
oil(lane)                 // chiếm 2 segment, segment sau trống lấy runway
itCross(kind, X)          // item context cross, 3 segment
itGaunt(kind, lane)       // gauntlet, 3 segment
itBait(kind, lane, exit)  // bait, 2 segment
```

`gsx` **không dùng ở P3** — nó ép dịch đúng 1 làn trong 16m, ở 50 m/s là 0.32s cho một
việc cần 0.25s.

Người thiết kế chỉ viết trật tự khối. **Compiler tự sửa** để không thể ghép lỗi: chèn
nhịp nghỉ khi chuỗi dày sắp tràn, chặn làn khi làn đó sắp thành hành lang an toàn, pad
tới đúng độ dài, chuẩn hoá đuôi phase để ghép A/B/C bất kỳ cũng an toàn ở chỗ nối.

### Auto-widen

`wv(a, b)` là hai hàng cách 16m. Nếu segment đó ở vùng v > 45.7 m/s, compiler **tự tách
thành 2 segment**, mỗi segment một hàng, để khoảng cách thành 32m:

```
wv(2, 0) ở giây 35  →  1 segment, 2 hàng cách 16m
wv(2, 0) ở giây 50  →  2 segment, 2 hàng cách 32m   (tag "weave-wide")
```

Đuôi `phase-reset` cũng giãn theo, nên đuôi P3 dài 3 slot. Việc giãn được tính vào ngân
sách độ dài trước khi đặt khối nên phase vẫn ra đúng số segment đặc tả.

### Context đặt item

| Context | Cách hoạt động |
|---|---|
| `cross` | Gate ép về một làn → 32m sau item ở làn đối diện → chặn lại làn item |
| `gauntlet` | Chặn làn L → 32m sau item ở chính làn L → chặn lại làn L |
| `bait` | Item trống trải → 16m sau gate mở ở làn kề, buộc rời ngay |

---

## Cơ chế booster

Booster **không** phải bất tử. Nó cấp:

- tốc độ ×1.35 trong 5 giây
- **2 lượt xuyên** (`BOOST_PASS`): xuyên qua 2 vật cản đầu tiên

Từ vật cản **thứ 3** trở đi, va vào là **mất luôn effect** và ăn đủ hình phạt —
`collided` 0.6s ở 0.55×, hoặc `slipping` nếu là oil. Lượt xuyên không để dành được: hết
5 giây là mất. Ăn booster thứ hai nạp lại đủ 2 lượt.

HUD hiện `⚡` kèm thời gian còn lại và hai chấm: đầy = còn dùng được, rỗng = đã tiêu.

Cơ chế này **chỉ có ở client** — `app.ts` không mô hình hoá booster, `CarStates` chỉ có
`moving` / `slipping` / `collided`.

**Ràng buộc kéo theo (rule 17).** Boost làm v ×1.35 nên hàng cách 16m ở cuối map chỉ còn
`16 / (50 × 1.35) = 0.237s`, ít hơn 0.25s cần để đổi một làn. Nếu cửa sổ boost chứa một
hàng như vậy, người chơi buộc tiêu lượt xuyên dù lái đúng. Rule 17 chặn điều đó.

---

## Validator (17 rule)

Chạy trên mọi tổ hợp, tất cả tính bằng mét và giây thật.

| # | Rule |
|---|---|
| 1 | Hàng đúng lattice 16m |
| 2 | Reaction ≥ 1.4× thời gian đổi làn (chỉ xét trong 2300m thực) |
| 3 | Luôn còn ≥1 làn mở |
| 4 | Mọi hàng đều né được (số làn phải dịch vs thời gian có) |
| 5 | Runway sau oil ≥ 1s |
| 6 | Item nằm trong tầm đổi làn từ hàng trước |
| 7 | Làn trống liên tiếp ≤ 5 segment (chống hành lang an toàn) |
| 8 | Chuỗi segment có vật cản ≤ 6 (nhịp thở) |
| 9 | Mật độ tăng đều P1 < P2 < P3 (đo **obs/giây**) |
| 10 | Đủ 4 loại vật cản |
| 11 | 2 booster + 1 gift |
| 12 | Item cách nhau ≥ 250m |
| 13 | Item trong cửa sổ thời gian |
| 14 | Item nằm trong tầm với sau 5 va chạm |
| 15 | Map phủ 60s + dự phòng boost |
| 16 | Ngân sách boost ≤ 20% |
| 17 | Cửa sổ boost né được ở 1.35× tốc độ |

Ba rule cần giải thích vì chúng không hiển nhiên:

**Rule 2** chỉ xét 2300m đầu. Đoạn sau là dự phòng boost — người chơi chỉ tới nếu đã ăn
cả hai booster, và tốc độ ở đó là ngoại suy ngoài `SPEED_LEVELS`.

**Rule 9 đo obs/giây, không phải obs/segment.** obs/segment là thước đo sai ở phase
cuối: tốc độ 45–50 m/s buộc hàng giãn từ 16m lên 32m, nên số vật cản trên mỗi 32m tất
yếu giảm dù áp lực thực tế tăng.

| Phase | obs/giây | obs/segment |
|---|---|---|
| P1 | 0.88 – 0.98 | 1.13 – 1.25 |
| P2 | 1.50 – 1.60 | 1.36 – 1.45 |
| P3 | 1.69 – 1.86 | 1.18 – 1.30 |

**Rule 14** hỏi câu mà rule 6 không hỏi: người chơi có **đi tới được** chỗ đó không.
Rule 6 chỉ kiểm hình học (có kịp đổi làn tới item). Rule 14 mô phỏng quãng đường còn
lại sau 5 va chạm và yêu cầu mọi item nằm trong đó.

### Lint thư viện

Chạy trước khi ghép, bắt lỗi do sửa tay:

- 3 biến thể cùng độ dài, cùng kết thúc bằng segment trống
- mọi cặp hàng trong biến thể đều né được ở tốc độ **tệ nhất** phase đó có thể gặp
- đủ item theo đặc tả phase
- ranh giới phase khớp mốc thời gian trong sai số 1.5s
- gift nằm trong 30–70% của P2

---

## Pattern pool cho Unity

Unity bốc pattern **độc lập từng segment**: `tier` = `activeTime` lớn nhất ≤ `gameTime`,
rồi bốc 1 pattern trong tier. Hai pattern bất kỳ trong cùng tier đều có thể nằm kề nhau,
nên pool phải an toàn với **mọi cặp**.

### Luật pool

| # | Luật | Lý do |
|---|---|---|
| R1 | Không hàng nào bịt cả 3 làn | không có đường đi |
| R2 | Hàng y=+8 không được chỉ mở một làn **biên** | nếu không sẽ có cặp mở{L} → mở{R} cách 16m, cần 0.5s mà chỉ có 0.32s |
| R3 | Hai hàng trong cùng pattern lệch tối đa 1 làn | 16m chỉ đủ 1 làn |
| R4 | Oil đứng một mình trong segment | để có runway 32m |

### Tier (cộng dồn)

| Tier | Pattern | Max obs/segment | Speed | React/16m | Oil |
|---|---|---|---|---|---|
| ≥0s | 1 | 0 | 20 | 0.80s | — |
| ≥3s | 9 | 2 | 23 | 0.70s | — |
| ≥10s | 18 | 3 | 30 | 0.53s | — |
| ≥20s | 21 | 3 | 35 | 0.46s | 3 |
| ≥30s | 28 | 4 | 40 | 0.40s | 3 |
| ≥45s | 32 | 4 | 45 | 0.36s | 3 |

Tổng 32 pattern riêng biệt, xuất ra 6 tier / 109 entry (pattern tier trước lặp lại ở
tier sau, đúng như `app.ts` mong đợi).

### Kiểm chứng

- **1024 cặp** pattern kề nhau, tất cả né được ở 50 m/s
- **500 seed** mô phỏng đúng pipeline `app.ts`: SFC32 PRNG, chọn tier theo thời gian,
  luật anti safe-lane streak ≤ 2

### Sửa pool

Mảng `POOL` trong `unity_patterns.js`:

```js
single(lane)   // 1 vật cản
gate(open)     // chặn 2 làn, chỉ mở `open`
oilRow(lane)   // vũng dầu
```

Khai báo `P(tên, hàng_y−8, hàng_y+8, tier)`. Sửa xong chạy `node export_unity.js --check`.

---

## Oil cần quyết một lần

Oil gây `slipping` 1.0s, nhưng runway tối đa một pattern **tự đảm bảo** được chỉ là 32m
(oil ở y=−8, y=+8 trống). Ở 50 m/s đó là 0.64s < 1.0s.

Không thể chừa thêm vì pattern kế tiếp do Unity bốc độc lập — giới hạn kiến trúc, không
phải lỗi soạn pattern. Chọn một trong hai, cả hai đã kiểm chứng 100%:

| | Cách | Lệnh |
|---|---|---|
| **A** (mặc định) | Giữ oil mọi tier, sửa `init_data.json`: `carState.slipping.activeDuration = 0.64` | `node export_unity.js` |
| **B** | Giữ `slipping = 1.0`, oil chỉ ở tier speed ≤ 32 m/s (activeTime < 14s) | `node export_unity.js --oil-early` |

Phương án B giảm pool ở tier nhanh: `20s: 21→18`, `30s: 28→25`, `45s: 32→29`.

Panel Unity Export trên web có radio xem trước cả hai.

---

## Xuất item cho Unity

Schema `roadPathPatternInfos` không có chỗ cho item, nên `--items` xuất riêng
`items.json` với `distanceY` (world Y) và `x` (làn) cho cả 27 tổ hợp. Spawn bằng hệ
thống riêng.

```
worldY = segment × 32 + 16 + localY
```

---

## Web tool

Mở `index.html`. Cột trái là dữ liệu, cột phải là chơi thử.

| Tab | Nội dung |
|---|---|
| **Map** | Strip thống kê, sơ đồ map, validator, item placement, obstacle, spawn list |
| **Thiết kế** | Phase/difficulty curve, variant library, speed levels, config đầy đủ |
| **Unity Export** | Pattern pool (sơ đồ + toạ độ), tier, luật pool, JSON preview |

Bảng dài có ô lọc và header dính khi cuộn. Bảng pattern hiện sơ đồ 3 làn × 2 hàng kèm
toạ độ `x, y` đúng thứ tự Unity sort, copy vào là khớp. Panel Unity Export có nút
**Lint**, **Mô phỏng 500 seed**, **Copy JSON**, **Tải file**.

Thông số luật chơi (điểm, thời gian phạt, ramp, boost) hiện ngay dưới khung game.

### Chơi thử

| Thao tác | Việc |
|---|---|
| **Kéo** chuột hoặc ngón tay | lái tự do, xe đi theo con trỏ |
| **Chạm nhanh** nửa trái/phải | đổi 1 làn |
| `←` `→` hoặc `A` `D` | đổi 1 làn |
| `Space` | Play khi chưa chạy · Pause/Resume khi đang chạy · Chơi lại khi hết giờ |
| `P` hoặc `Esc` | Pause / Resume |
| `✕` | thoát phiên chơi, mở lại bảng dữ liệu |

Khi kéo, xe vẫn bị giới hạn `LATERAL_V = 14 m/s` và biên `±5.25m` đúng như Unity. Drag
chỉ đặt **đích đến**, xe đi tới đích qua cùng phép giới hạn tốc độ như khi bấm phím —
nên không thể lách qua vật cản nhanh hơn mức validator dùng để kiểm map. Nhả tay thì xe
snap về làn gần **đích** nhất, không phải gần vị trí hiện tại.

Bấm tiếp tục sau pause sẽ **đếm ngược 3 giây**; đồng hồ game không chạy trong lúc đếm.
Đổi biến thể A/B/C thì dựng map mới và về trạng thái chờ, không tự chạy.

Trên mobile, bấm Play thì khung game ghim toàn màn hình và trang bị khóa cuộn.

Trạng thái phiên chơi, tách khỏi trạng thái xe (`moving` / `collided` / `slipping`):

```
idle → running ⇄ paused → countdown → running
                              ↓
                            over → running
```

---

## Quy trình sửa map

1. Sửa `PHASE_SPEC` trong `level_design.js` (bố cục) hoặc `POOL` trong
   `unity_patterns.js` (pattern cho Unity)
2. `node check_levels.js` — lint + 27 tổ hợp
3. `node export_unity.js --check` — luật pool + 1024 cặp + 500 seed
4. `node export_unity.js --items` — ghi file khi đã sạch
5. Mở `index.html` chơi thử

Hai lỗi hay gặp:

- *"khối bị cắt vì thiếu chỗ"* → **bớt beats**, đừng tăng `len`. Tăng `len` làm ranh
  giới phase lệch mốc thời gian và lint sẽ báo lỗi khác. Lưu ý auto-widen: một khối `wv`
  ở nửa sau P3 chiếm 2 segment chứ không phải 1.
- *"phase kết thúc ở giây X"* → `len` đã lệch mốc thời gian. Thông báo kèm số segment
  cần thiết.

---

## Độ chặt của map

Map hợp lệ không có nghĩa là dễ chịu. Ba số này quyết định cảm giác "khó di chuyển",
đo trên cả 27 tổ hợp:

| Số đo | Ý nghĩa | Hiện tại |
|---|---|---|
| Slack tối thiểu | thời gian dư sau khi đã đổi làn xong | **0.118s** (7 frame @60fps) |
| Tỉ lệ hàng 16m | hàng chỉ cách hàng trước 16m | **36%** |
| Hàng chỉ 1 làn mở | không có lựa chọn, buộc vào đúng một chỗ | **34%** |

Phân bố khoảng cách giữa các hàng (A-A-A): 16m × 24 · 32m × 32 · 48m × 7 · 64m × 10 ·
80m × 1.

Nếu map trở nên khó di chuyển, ba đòn hiệu quả nhất theo thứ tự:

1. Tăng `REACT_MARGIN` (hiện 1.4) — buộc mọi hàng giãn ra ở tốc độ cao
2. Thay `gsx` bằng chuỗi `gt` liên tiếp — vẫn 2 vật cản/segment nhưng hàng cách 32m,
   tăng áp lực không bằng cách bóp thời gian phản xạ
3. Giảm tỉ lệ hàng chỉ 1 làn mở, bằng cách đổi một số `gt` thành `sg` hoặc `wv`
