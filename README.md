# Road Rush — Level Design

Tool thiết kế và kiểm chứng map cho game runner 3 làn, 60 giây. Sinh
`road_path_patterns.json` cho Unity dùng trực tiếp.

Mọi ràng buộc suy ra từ tốc độ thật của game và được kiểm bằng máy trước khi xuất.
Exporter không ghi file nếu có lỗi (exit code 1).

## Chạy

```bash
node check_levels.js             # lint thư viện + kiểm 27 tổ hợp map
node export_unity.js --check     # kiểm pool + 1024 cặp + 500 seed, không ghi
node export_unity.js             # ghi road_path_patterns.json (backup .bak)
node export_unity.js --items     # ghi thêm items.json
node export_unity.js --oil-early # phương án B cho oil (xem mục Oil)
```

Mở `index.html` để xem chỉ số và chơi thử. Không cần server.

## File

| File | Vai trò |
|---|---|
| `level_design.js` | Config, DSL, biến thể A/B/C, compiler, validator 17 rule |
| `unity_patterns.js` | Pattern pool 32 mẫu, luật R1–R4, mô phỏng pipeline Unity |
| `export_unity.js` | Sinh `road_path_patterns.json` + `items.json` |
| `check_levels.js` | Lint thư viện + kiểm 27 tổ hợp |
| `index.html` | Bảng chỉ số + tab xếp map bằng tay + chơi thử |
| `road_path_patterns.json` | **File Unity đọc** — do exporter ghi ra |
| `items.json` | Booster/gift theo `distanceY` (sinh bởi `--items`) |
| `app.ts`, `init_data.json` | Server + config game |

Hai module dùng UMD nên browser và node chung một nguồn sự thật.

### Giá trị phải đồng bộ 4 chỗ

`activeDuration` và `speedMultiplier` của `collided` / `slipping` phải khớp tuyệt đối
giữa `level_design.js`, `index.html`, `app.ts` (`CarStates`), `init_data.json`
(`carState`). Server dùng chúng mô phỏng lại quãng đường; lệch là anti-cheat trả
`distance > allowedMaxDistance` → "Xác thực khoảng cách thất bại".

Hiện: `collided = 0.6s × 0.55`, `slipping = 1.0s`. Ramp hồi phục `0.5s` không cần đồng
bộ — nó chỉ làm client chậm hơn server, mà server chỉ kiểm cận trên.

## Thông số game

| Thông số | Giá trị |
|---|---|
| Thời lượng | 60s |
| Làn | 3, tâm tại x = −3.5 / 0 / +3.5 |
| Chiều rộng đường | 16m |
| Biên di chuyển | ±5.25m (`CarLimitX`) |
| Segment | 32m × 16m |
| Xe | 2.49 × 3.965, BoxCollider2D offset 0 |
| Tốc độ ngang | 22 m/s ⇒ đổi 1 làn = **0.159s** |

Tốc độ ngang là lựa chọn của client, không phải ràng buộc server. `app.ts` chỉ giới hạn
`MAX_LATERAL_DELTA_PER_SNAPSHOT = 3.75m` mỗi snapshot 1m đi tới (trần lý thuyết 75 m/s);
22 m/s cho dịch ngang cao nhất 1.10m/1m dọc, dưới 30% ngưỡng.

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

Một va chạm mất khoảng 9–11m. Tổng thời gian xe không chạy đủ tốc là `0.6 + 0.5 = 1.1s`.
Hết `collided`, tốc độ bò từ `0.55×` lên `1.0×` trong `RECOVER_DUR = 0.5s`:

```js
v *= COLLIDE_MULT + (1 - COLLIDE_MULT) * (1 - recover/RECOVER_DUR)
```

### Đếm va chạm khi nhiều vật cản cùng hàng

Hai làn kề cách 3.5m, nhưng nửa tổng bề rộng xe + fence là 3.0m — xe ở giữa hai làn sẽ
overlap **cả hai** collider. Hình học collider không đổi (phải khớp Unity); chỉ cách
**đếm** khác. Trong mỗi hàng (cùng world Y):

- vật cản xuyên **sâu nhất** theo trục X luôn tính 1 va chạm
- vật cản còn lại chỉ tính thêm nếu xuyên `≥ HIT_DEPTH_MIN = 0.5m`

| Tình huống | Độ xuyên | Số va chạm |
|---|---|---|
| Hai `fence` làn kề, xe ở giữa | 1.25m mỗi bên | 2 |
| Hai `cone` làn kề, xe ở giữa | 0.45m mỗi bên | 1 (chỉ kẹp mép) |
| Đâm giữa `fence`, có `fence` làn kề | 3.0m / không chạm | 1 |
| Hai vật cản khác hàng | — | 2 |

Luật "sâu nhất luôn tính" là bắt buộc: nếu chỉ dùng ngưỡng, ca hai `cone` sẽ cho 0 va
chạm dù xe xuyên qua cả hai.

### Item

| Item | Số lượng | Hiệu ứng |
|---|---|---|
| Booster | 2 | tốc độ ×1.35 trong 5s + xuyên **2** vật cản |
| Gift | 1 | **voucher** — vật phẩm, không cộng điểm |

Collider 2.6 × 2.6. Ngân sách boost 2 × 5s / 60s = 17% thời lượng.

## Tính điểm

**Điểm = quãng đường đã đi, đơn vị mét.** Không có nguồn điểm nào khác, không có biến
`score` trong game state — điểm chính là `G.dist`, chỉ định dạng lại khi hiển thị.

```
1,655.05   =   1655 mét  +  5 cm
```

| | Ảnh hưởng tới điểm |
|---|---|
| Booster | **gián tiếp** — ×1.35 tốc độ 5s ⇒ đi thêm ~42m |
| Xuyên vật cản khi boost | không cộng gì, chỉ tránh mất quãng đường |
| Gift | **không** — voucher là vật phẩm riêng |
| Va chạm | giảm điểm vì mất ~10m |

Chạy sạch không ăn booster = `2,299.75`. Tối đa lý thuyết ≈ `2,458`.

`2,299.75` chứ không phải `2,300` chẵn vì forward-Euler với `dt = 1/60` cho kết quả thấp
hơn tích phân chính xác một chút. Server dùng đúng phép tính đó nên hai bên khớp.
`BASE_DIST = 2300` chỉ dùng để tính độ dài map cần thiết.

### Điểm tất định

Phần thập phân chỉ có nghĩa cho xếp hạng nếu không phụ thuộc máy người chơi. Hai điều
kiện, cả hai đã đạt:

1. **Fixed timestep `1/60s`.** `step()` chỉ được gọi với `dt = FIXED_DT = 1/60`, đúng
   bằng `UNITY_FIXED_DELTA_TIME` trong `app.ts`. Vòng lặp tích luỹ thời gian thực rồi
   chạy step theo bội số, phần dư giữ cho frame sau. Vẽ vẫn theo frame rate máy. Chênh
   lệch điểm giữa 30/60/120/240 fps: **0.000000m**.
2. **Thứ tự tích phân khớp server.** Tính tốc độ tại `G.t` hiện tại, cộng quãng đường,
   *rồi mới* tăng `G.t` — đúng như `app.ts`:

```js
const v = getBaseSpeedAtTime(timeCursor) * multiplier
simulatedDistance += v * dt
timeCursor += dt
```

Client khớp `simulatedDistance` của server chính xác 0.000000m, chứ không chỉ nằm dưới
cận trên `allowedMaxDistance`.

Đơn vị là mét vì một frame ở 50 m/s đi 0.83m — ghi km cho ra `2.30`, quá thô để phân biệt
người chơi. Cả hệ thống cũng tính bằng mét và `app.ts` xác thực `distance` theo mét, nên
không có phép quy đổi nào để sai.

| Đại lượng | Độ lớn |
|---|---|
| Một booster | ~42 m |
| Một va chạm | ~10 m |
| Một frame @50 m/s | 0.83 m |
| Chênh lệch do frame rate | **0 m** |
| Dung sai anti-cheat (`sim × 1.01`) | 23 m |

## Nguyên lý thiết kế

### Lattice 16m

Vật cản chỉ đặt ở **local y = −8 hoặc +8** trong segment 32m, nhờ đó khoảng cách hai
hàng liền nhau luôn là bội số của 16m, kể cả khi vắt qua ranh giới segment. Bắt buộc vì
Unity bốc pattern độc lập từng segment, không biết segment trước có gì.

### Ngân sách thời gian

| Khoảng cách | @20 | @30 | @40 | @45 | @50 |
|---|---|---|---|---|---|
| **16m** | 0.80s | 0.53s | 0.40s | 0.36s | 0.32s |
| **32m** | 1.60s | 1.07s | 0.80s | 0.71s | 0.64s |

**Ngưỡng `MIN_ROW_GAP_TIME = 0.35s`** — đủ thời gian dịch làn không có nghĩa là chơi
được, người chơi còn phải nhận biết và quyết định. 0.35s là 21 frame @60fps, trong đó
đổi làn chỉ chiếm 0.159s. Đây là ngưỡng **tuyệt đối**, không phải hệ số nhân thời gian
đổi làn: thời gian phản ứng của người chơi không phụ thuộc xe dịch nhanh bao nhiêu.

Từ đó suy ra tốc độ tối đa mà hàng 16m còn dùng được:

```
16 / 0.35 = 45.7 m/s   →  khoảng giây 47 trở đi
```

Sau mốc này mọi hàng có vật cản buộc phải cách 32m (compiler tự lo, xem *auto-widen*).
Đây cũng là lý do gate luôn để hàng sau trống, và lý do pattern 4–5 vật cản đặt ở
y = −11/−3/+3/+11 không dùng được (hàng cách 6–8m = 0.12–0.16s ở P3).

## Cấu trúc map

Map = ghép 3 phase, mỗi phase 3 biến thể **A/B/C** soạn tay ⇒ **27 tổ hợp**, hoàn toàn
tất định. Không seed, không random runtime. Chọn cone/fence/tire theo công thức cố định
`(seg×7 + row×3 + lane) % 3`.

| Phase | Segment | Quãng đường | Thời gian | Nội dung |
|---|---|---|---|---|
| P1 Warmup | 8 | 0–256m | 0–10.2s | chỉ vật cản đơn + nhịp nghỉ, **không gate** |
| P2 Cruise + Trap | 22 | 256–960m | 10.2–30.2s | gate thưa + weave, oil, **1 booster + 1 gift** |
| P3 Intense + Peak | 50 | 960–2560m | 30.2–65.2s | chuỗi gate, weave tự giãn, oil, **1 booster** |

Số vật cản mỗi biến thể:

| | A | B | C | Segment trống |
|---|---|---|---|---|
| P1 | 7 | 7 | 8 | 2–3 / 8 |
| P2 | 25 | 26 | 26 | 5 / 22 |

Sàn cứng của mật độ là ~6 vật cản cho P1 và ~17 cho P2: `MAX_FREE_STREAK = 5` buộc mỗi
làn phải bị chặn ít nhất một lần trong mỗi 4 segment, cộng 3 vật cản của đuôi
`phase-reset`. Thưa hơn nữa phải nới `MAX_FREE_STREAK`, nhưng điều đó mở đường cho
"hành lang an toàn".

Tổng 80 segment = 2560m, cả 27 tổ hợp đều ra 80 segment. Độ dài phase khớp mốc thời
gian: `distAtTime(30) − distAtTime(10) = 700m ÷ 32 = 22`.

### Vị trí item (tổ hợp A-A-A)

| Item | Vị trí | Giây | Làn | Context |
|---|---|---|---|---|
| Booster | 360m | 13.6s | R | cross |
| Gift | 648m | 22.1s | L | bait |
| Booster | 1352m | 39.7s | R | cross |

Gift đặt ở giữa P2 (50% của phase) để còn nhiều dư địa quãng đường phía sau.

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

`gsx` hiện không dùng ở đâu cả — nó ép dịch đúng 1 làn trong 16m, ở 50 m/s là 0.32s cho
một việc cần 0.25s. Giữ lại trong DSL để dùng nếu cần nhịp gắt có kiểm soát.

Người thiết kế chỉ viết trật tự khối. **Compiler tự sửa** để không thể ghép lỗi: chèn
nhịp nghỉ khi chuỗi dày sắp tràn, chặn làn khi làn đó sắp thành hành lang an toàn, pad
tới đúng độ dài, chuẩn hoá đuôi phase để ghép A/B/C bất kỳ cũng an toàn ở chỗ nối.

### Auto-widen

`wv(a, b)` là hai hàng cách 16m. Nếu segment đó ở vùng v > 45.7 m/s, compiler tự tách
thành 2 segment, mỗi segment một hàng, để khoảng cách thành 32m:

```
wv(2, 0) ở giây 35  →  1 segment, 2 hàng cách 16m
wv(2, 0) ở giây 50  →  2 segment, 2 hàng cách 32m   (tag "weave-wide")
```

Đuôi `phase-reset` cũng giãn theo (đuôi P3 dài 3 slot). Việc giãn được tính vào ngân sách
độ dài trước khi đặt khối nên phase vẫn ra đúng số segment đặc tả.

### Context đặt item

| Context | Cách hoạt động |
|---|---|
| `cross` | Gate ép về một làn → 32m sau item ở làn đối diện → chặn lại làn item |
| `gauntlet` | Chặn làn L → 32m sau item ở chính làn L → chặn lại làn L |
| `bait` | Item trống trải → 16m sau gate mở ở làn kề, buộc rời ngay |

## Cơ chế booster

Booster không phải bất tử. Nó cấp tốc độ ×1.35 trong 5 giây và **2 lượt xuyên**
(`BOOST_PASS`). Từ vật cản **thứ 3** trở đi, va vào là mất luôn effect và ăn đủ hình phạt.
Lượt xuyên không để dành được; ăn booster thứ hai nạp lại đủ 2 lượt.

Cơ chế này chỉ có ở client — `app.ts` không mô hình hoá booster, `CarStates` chỉ có
`moving` / `slipping` / `collided`.

**Ràng buộc kéo theo (rule 17).** Boost làm v ×1.35 nên hàng cách 16m ở cuối map chỉ còn
`16 / (50 × 1.35) = 0.237s`, ít hơn 0.25s cần để đổi một làn. Nếu cửa sổ boost chứa một
hàng như vậy, người chơi buộc tiêu lượt xuyên dù lái đúng. Rule 17 chặn điều đó.

## Validator (17 rule)

Chạy trên mọi tổ hợp, tất cả tính bằng mét và giây thật.

| # | Rule |
|---|---|
| 1 | Hàng đúng lattice 16m |
| 2 | Khoảng cách hàng ≥ 0.35s (chỉ xét trong 2300m thực) |
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

Ba rule cần giải thích:

**Rule 2** chỉ xét 2300m đầu. Đoạn sau là dự phòng boost — người chơi chỉ tới nếu đã ăn
cả hai booster, và tốc độ ở đó là ngoại suy ngoài `SPEED_LEVELS`.

**Rule 9 đo obs/giây, không phải obs/segment.** Ở phase cuối tốc độ 45–50 m/s buộc hàng
giãn từ 16m lên 32m, nên obs/segment tất yếu giảm dù áp lực thực tế tăng.

| Phase | obs/giây | obs/segment |
|---|---|---|
| P1 | 0.69 – 0.78 | 0.88 – 1.00 |
| P2 | 1.25 – 1.30 | 1.14 – 1.18 |
| P3 | 1.69 – 1.86 | 1.18 – 1.30 |

**Rule 14** hỏi câu mà rule 6 không hỏi: người chơi có **đi tới được** chỗ đó không.
Rule 6 chỉ kiểm hình học. Rule 14 mô phỏng quãng đường còn lại sau 5 va chạm và yêu cầu
mọi item nằm trong đó.

### Lint thư viện

Chạy trước khi ghép, bắt lỗi do sửa tay:

- 3 biến thể cùng độ dài, cùng kết thúc bằng segment trống
- mọi cặp hàng trong biến thể đều né được ở tốc độ **tệ nhất** phase đó có thể gặp
- đủ item theo đặc tả phase
- ranh giới phase khớp mốc thời gian trong sai số 1.5s
- gift nằm trong 30–70% của P2

## Pattern pool cho Unity

Unity bốc pattern **độc lập từng segment**: `tier` = `activeTime` lớn nhất ≤ `gameTime`,
rồi bốc 1 pattern trong tier. Hai pattern bất kỳ trong cùng tier đều có thể nằm kề nhau,
nên pool phải an toàn với **mọi cặp**.

| # | Luật pool | Lý do |
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

Tổng 32 pattern riêng biệt, xuất ra 6 tier / 109 entry (pattern tier trước lặp lại ở tier
sau, đúng như `app.ts` mong đợi).

Kiểm chứng: **1024 cặp** pattern kề nhau đều né được ở 50 m/s; **500 seed** mô phỏng đúng
pipeline `app.ts` (SFC32 PRNG, chọn tier theo thời gian, anti safe-lane streak ≤ 2).

Sửa pool trong mảng `POOL` của `unity_patterns.js`:

```js
single(lane)   // 1 vật cản
gate(open)     // chặn 2 làn, chỉ mở `open`
oilRow(lane)   // vũng dầu
```

Khai báo `P(tên, hàng_y−8, hàng_y+8, tier)`. Sửa xong chạy `node export_unity.js --check`.

## Oil cần quyết một lần

Oil gây `slipping` 1.0s, nhưng runway tối đa một pattern tự đảm bảo được chỉ là 32m (oil
ở y=−8, y=+8 trống) — ở 50 m/s là 0.64s < 1.0s. Không thể chừa thêm vì pattern kế tiếp do
Unity bốc độc lập; đây là giới hạn kiến trúc, không phải lỗi soạn pattern. Chọn một trong
hai, cả hai đã kiểm chứng 100%:

| | Cách | Lệnh |
|---|---|---|
| **A** (mặc định) | Giữ oil mọi tier, sửa `init_data.json`: `carState.slipping.activeDuration = 0.64` | `node export_unity.js` |
| **B** | Giữ `slipping = 1.0`, oil chỉ ở tier speed ≤ 32 m/s (activeTime < 14s) | `node export_unity.js --oil-early` |

Phương án B giảm pool ở tier nhanh: `20s: 21→18`, `30s: 28→25`, `45s: 32→29`. Panel Unity
Export trên web có radio xem trước cả hai.

## Xuất item cho Unity

Schema `roadPathPatternInfos` không có chỗ cho item, nên `--items` xuất riêng `items.json`
với `distanceY` (world Y) và `x` (làn) cho cả 27 tổ hợp. Spawn bằng hệ thống riêng.

```
worldY = segment × 32 + 16 + localY
```

## Web tool

Mở `index.html`. Cột trái là dữ liệu, cột phải là chơi thử.

| Tab | Nội dung |
|---|---|
| **Map** | Strip thống kê, sơ đồ map, validator, item placement, obstacle, spawn list |
| **Thiết kế** | Phase/difficulty curve, variant library, speed levels, config đầy đủ |
| **Xếp tay** | Lưới xếp map thủ công + validator trực tiếp |
| **Unity Export** | Pattern pool (sơ đồ + toạ độ), tier, luật pool, JSON preview |

Bảng dài có ô lọc và header dính khi cuộn. Bảng pattern hiện sơ đồ 3 làn × 2 hàng kèm
toạ độ `x, y` đúng thứ tự Unity sort. Panel Unity Export có nút **Lint**, **Mô phỏng 500
seed**, **Copy JSON**, **Tải file**. Thông số luật chơi hiện ngay dưới khung game.

### Tab Xếp tay

Bố cục theo thứ tự làm việc: **sinh map → đọc thống kê → xem lỗi → sửa lưới**.

Nút **⚙ Generate** ghép 3 phase từ thư viện A/B/C qua **đúng compiler** của
`level_design.js`, nên map sinh ra giống hệt map thật.

| Mức | Cách làm | Vật cản |
|---|---|---|
| **Dễ** | bỏ ~35% vật cản, ưu tiên hàng dày; giữ nguyên oil và item | ~65 |
| **Chuẩn** | ghép A/B/C ngẫu nhiên, không chỉnh gì | ~95 |
| **Khó** | thêm vật cản đơn vào hàng thưa ở P2/P3 | ~146 |

Dễ và Khó chỉnh trên kết quả của Chuẩn, và mỗi bước chỉnh đều kiểm lại validator — thay
đổi nào làm tăng số rule fail thì bị hoàn lại (đã kiểm 60 lần sinh, 0 lỗi). Mức Khó quét
cả hàng đã có 1 vật cản, chỉ tránh hàng đã là gate và hàng có oil/item.

**Lưới.** Mỗi segment là một khối riêng, viền trái màu theo phase, segment trống làm mờ.
Thanh trên mỗi khối hiện `#segment · phase · mét · giây · tốc độ`.

| Cột | Nội dung |
|---|---|
| meta | `localY · worldY · giây` |
| **Δ** | khoảng cách tới hàng có vật cản trước, kèm thời gian có được — **đỏ** nếu dưới 0.35s |
| L / C / R | ô bấm để đặt vật cản |
| mở | số làn còn mở; vàng khi chỉ còn 1 |
| ⚠ | lý do hàng không hợp lệ, ngay tại hàng đó |

Bấm ô để đặt, bấm lại để xoá, giữ chuột kéo qua nhiều ô để tô nhanh. Cảnh báo tại chỗ
dùng cùng phép tính và cùng hằng số `MIN_ROW_GAP_TIME` với `validate()`, nên không thể có
chuyện lưới báo xanh mà validator báo đỏ.

| Nút | Việc |
|---|---|
| **▶ Chơi map này** | đưa map tự xếp vào khung chơi thử bên phải |
| **⤓ Nạp combo** | nạp map A/B/C đang chọn vào lưới để sửa tiếp |
| **✕ Xoá hết** · **±8 seg** | lưới trống · đổi độ dài (tối thiểu 8) |
| **⧉ Copy** · **⤒ Dán** | lưu và chia sẻ bố cục dạng JSON |

Map tự xếp không đi qua compiler (compiler sẽ ghi đè ý người dùng) nhưng chạy qua cùng
`validate()`, lỗi sắp lên đầu bảng, số lỗi hiện trên nhãn tab. "Chơi map này" không kiểm
lỗi trước, để bạn thử map chưa hoàn thiện.

### Chơi thử

| Thao tác | Việc |
|---|---|
| **Kéo** chuột hoặc ngón tay | lái tự do, xe đi theo con trỏ |
| **Chạm nhanh** nửa trái/phải | đổi 1 làn |
| `←` `→` hoặc `A` `D` | đổi 1 làn |
| `Space` | Play · Pause/Resume · Chơi lại khi hết giờ |
| `P` hoặc `Esc` | Pause / Resume |
| `✕` | thoát phiên chơi, mở lại bảng dữ liệu |

Khi kéo, xe vẫn bị giới hạn `LATERAL_V = 22 m/s` và biên `±5.25m` đúng như Unity. Drag chỉ
đặt **đích đến**, xe đi tới đích qua cùng phép giới hạn tốc độ như khi bấm phím — không thể
lách qua vật cản nhanh hơn mức validator dùng để kiểm map. Nhả tay thì xe snap về làn gần
**đích** nhất, không phải gần vị trí hiện tại.

`DRAG_GAIN = 1.8`: vuốt 1px màn hình cho ra 1.8px thế giới (~217px trên canvas 390px là đi
hết chiều rộng đường). Hệ số này chỉ đặt đích, không đổi tốc độ ngang thực tế nên không
ảnh hưởng anti-cheat.

Bấm tiếp tục sau pause sẽ **đếm ngược 3 giây** bằng thời gian thực; đồng hồ game không
chạy trong lúc đếm. Đổi biến thể A/B/C thì dựng map mới và về trạng thái chờ.

Vòng lặp chạy `step()` với `dt` cố định `1/60`, tối đa 5 bước mỗi frame. Quá 5 bước thì bỏ
phần nợ thời gian thay vì dồn tích — tab ngủ 30 giây không làm xe nhảy 30 giây quãng đường.
Trên mobile, bấm Play thì khung game ghim toàn màn hình và trang bị khóa cuộn.

Trạng thái phiên chơi, tách khỏi trạng thái xe (`moving` / `collided` / `slipping`):

```
idle → running ⇄ paused → countdown → running
                              ↓
                            over → running
```

## Quy trình sửa map

1. Sửa `PHASE_SPEC` trong `level_design.js` (bố cục) hoặc `POOL` trong
   `unity_patterns.js` (pattern cho Unity)
2. `node check_levels.js` — lint + 27 tổ hợp
3. `node export_unity.js --check` — luật pool + 1024 cặp + 500 seed
4. `node export_unity.js --items` — ghi file khi đã sạch
5. Mở `index.html` chơi thử

Hai lỗi hay gặp:

- *"khối bị cắt vì thiếu chỗ"* → **bớt beats**, đừng tăng `len`. Tăng `len` làm ranh giới
  phase lệch mốc thời gian. Lưu ý auto-widen: một khối `wv` ở nửa sau P3 chiếm 2 segment.
- *"phase kết thúc ở giây X"* → `len` đã lệch mốc thời gian. Thông báo kèm số segment cần.

## Độ chặt của map

Map hợp lệ không có nghĩa là dễ chịu. Ba số này quyết định cảm giác "khó di chuyển", đo
trên cả 27 tổ hợp:

| Số đo | Ý nghĩa | Hiện tại |
|---|---|---|
| Slack tối thiểu | thời gian dư sau khi đã đổi làn xong | **0.209s** (13 frame @60fps) |
| Tỉ lệ hàng 16m | hàng chỉ cách hàng trước 16m | **32%** |
| Hàng chỉ 1 làn mở | không có lựa chọn, buộc vào đúng một chỗ | **30%** |

Phân bố khoảng cách giữa các hàng (A-A-A): 16m × 19 · 32m × 31 · 48m × 8 · 64m × 11 ·
80m × 1. Tổng 71 hàng có vật cản.

Nếu map trở nên khó di chuyển, ba đòn hiệu quả nhất theo thứ tự:

1. Tăng `MIN_ROW_GAP_TIME` (hiện 0.35s) — buộc mọi hàng giãn ra ở tốc độ cao
2. Thay `gsx` bằng chuỗi `gt` liên tiếp — vẫn 2 vật cản/segment nhưng hàng cách 32m
3. Giảm tỉ lệ hàng chỉ 1 làn mở, đổi một số `gt` thành `sg` hoặc `wv`
