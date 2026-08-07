# Road Rush — Level Design

Bộ công cụ thiết kế và kiểm chứng map cho game runner 3 làn, 60 giây. Sinh ra
`road_path_patterns.json` để Unity dùng trực tiếp.

Mục tiêu: **không thể tạo ra map không chơi được**. Mọi ràng buộc đều suy ra từ
tốc độ thật của game chứ không đặt tuỳ ý, và được kiểm bằng máy trước khi xuất file.

---

## Chạy

```bash
node export_unity.js             # kiểm tra + ghi road_path_patterns.json (backup .bak)
node export_unity.js --check     # chỉ kiểm tra, không ghi
node export_unity.js --oil-early # phương án B cho oil (xem mục Oil)
node export_unity.js --items     # ghi thêm items.json (booster/gift)
node check_levels.js             # lint + kiểm 27 tổ hợp map A/B/C
```

Exporter **không ghi file nếu có lỗi** và trả exit code 1, nên không thể đưa map
hỏng vào Unity. Mở `index.html` (không cần server) để xem chỉ số và chơi thử.

---

## File

| File | Vai trò |
|---|---|
| `level_design.js` | Config game, DSL, biến thể A/B/C, compiler, validator 16 rule |
| `unity_patterns.js` | Pattern pool 32 mẫu + luật R1–R4 + lint + mô phỏng pipeline Unity |
| `export_unity.js` | Sinh `road_path_patterns.json` |
| `check_levels.js` | Lint thư viện + kiểm 27 tổ hợp |
| `index.html` | Bảng chỉ số + chơi thử (dùng chung 2 module trên) |
| `road_path_patterns.json` | **File Unity đọc** — do exporter ghi ra |
| `items.json` | Booster/gift theo `distanceY` (sinh bởi `--items`) |
| `app.ts`, `init_data.json` | Server và config của game, tool không sửa |

Hai module dùng chung cho cả browser và node qua UMD, nên web và harness kiểm tra
luôn cùng một nguồn sự thật. Sinh ra khi chạy, không cần commit:
`road_path_patterns.json.bak`.

---

## Thông số game

Lấy từ `init_data.json` và `app.ts`.

### Đường và xe

| Thông số | Giá trị | Ghi chú |
|---|---|---|
| Thời lượng | 60s | |
| Số làn | 3 | tâm tại x = −3.5 / 0 / +3.5 |
| Chiều rộng đường | 16m | |
| Biên di chuyển | ±5.25m | `CarLimitX`, rộng hơn tâm làn ngoài |
| Segment | 32m × 16m | đơn vị ghép map của Unity |
| Kích thước xe | 2.49 × 3.965 | BoxCollider2D, offset 0 |
| Tốc độ ngang | 14 m/s | đổi 1 làn = 3.5 / 14 = **0.25s** |

### Tốc độ theo thời gian

Nội suy tuyến tính giữa các mốc.

| Giây | Tốc độ | Quãng đường tới đó |
|---|---|---|
| 0 | 20 m/s | 0m |
| 10 | 30 m/s | 250m |
| 30 | 40 m/s | 950m |
| 60 | 50 m/s | 2300m |

Chạy sạch 60 giây đi được **2300m**. Cộng dự phòng boost 158m ⇒ map cần phủ
tối thiểu **2458m**.

### Vật cản

| ID | Loại | Collider | Hiệu ứng |
|---|---|---|---|
| `cone` | normal | 1.9 × 2.41 | `collided` 2.5s, tốc độ ×0.25 |
| `tire` | normal | 3.3 × 2.57 | như trên |
| `fence` | normal | 3.51 × 2.64 | như trên |
| `oil` | oil | 3.28 × 2.33 | `slipping` 1.0s, mất lái |

Giá va chạm tính theo mét bị mất:

| Tốc độ | Mất |
|---|---|
| 20 m/s | 38m |
| 30 m/s | 56m |
| 40 m/s | 75m |
| 50 m/s | 94m |

### Item (mở rộng, không có trong schema Unity)

| Item | Số lượng | Điểm | Hiệu ứng |
|---|---|---|---|
| Booster | 2 | +150 | tốc độ ×1.35 trong 5s + xuyên **2** vật cản |
| Gift | 1 | +600 | — |

Collider item 2.6 × 2.6. Ngân sách boost 2 × 5s / 60s = 17% thời lượng.

---

## Nguyên lý thiết kế

### Lattice 16m

Vật cản chỉ được đặt ở **local y = −8 hoặc +8** trong segment 32m. Nhờ đó khoảng
cách giữa hai hàng liền nhau luôn là bội số của 16m — kể cả khi vắt qua ranh giới
segment. Điều này bắt buộc vì Unity bốc pattern **độc lập từng segment**, không
biết segment trước có gì.

### Ngân sách thời gian

Đổi một làn mất 0.25s. Từ đó suy ra số làn tối đa dịch được:

| Khoảng cách | @20 | @30 | @40 | @45 | @50 |
|---|---|---|---|---|---|
| **16m** | 0.80s · 3 làn | 0.53s · 2 làn | 0.40s · 1 làn | 0.36s · 1 làn | 0.32s · 1 làn |
| **32m** | 1.60s · 6 làn | 1.07s · 4 làn | 0.80s · 3 làn | 0.71s · 2 làn | 0.64s · 2 làn |

Ở tốc độ cuối, 16m chỉ đủ dịch **một** làn. Đây là lý do gate (chặn 2 làn, chỉ mở 1)
bắt buộc phải để hàng sau trống, tức hàng kế tiếp cách 32m.

**Biên an toàn `REACT_MARGIN = 1.4`.** Đủ thời gian về mặt hình học không có nghĩa
là chơi được: 16m @50 m/s cho 0.32s, đổi làn cần 0.25s, dư 0.07s — tức 4 frame ở
60fps, người chơi không kịp nhận biết. Nên map đòi mỗi hàng có ≥ `1.4 × 0.25 = 0.35s`.
Từ đó suy ra **tốc độ tối đa mà hàng 16m còn dùng được**:

```
16 / (0.25 × 1.4) = 45.7 m/s   →  khoảng giây 47 trở đi
```

Sau mốc này mọi hàng có vật cản **buộc** phải cách 32m. Compiler tự lo việc này
(xem *auto-widen*), designer không phải nhớ ngưỡng.

Cũng vì vậy các pattern 4–5 vật cản kiểu cũ đặt ở y = −11/−3/+3/+11 **không dùng
được**: chúng tạo hàng cách nhau 6–8m, tức 0.12–0.16s ở P3, không thể né.

---

## Cấu trúc map

Map = ghép 3 phase, mỗi phase có 3 biến thể **A/B/C** soạn tay. **27 tổ hợp**,
hoàn toàn tất định — không seed, không random runtime. Kể cả việc chọn
cone/fence/tire cũng theo công thức cố định `(seg×7 + row×3 + lane) % 3`.

| Phase | Segment | Quãng đường | Thời gian | Nội dung |
|---|---|---|---|---|
| P1 Warmup | 8 | 0–256m | 0–10.2s | single, weave, 1 gate |
| P2 Cruise + Trap | 22 | 256–960m | 10.2–30.2s | gate + weave, oil, **1 booster + 1 gift** |
| P3 Intense + Peak | 50 | 960–2560m | 30.2–65.2s | chuỗi gate, weave tự giãn 32m, oil, **1 booster** |

Tổng 80 segment = 2560m, dư so với 2458m cần thiết. Cả 27 tổ hợp đều ra 80 segment.

Độ dài phase được chọn để khớp mốc thời gian thiết kế:
`distAtTime(30) − distAtTime(10) = 950 − 250 = 700m ÷ 32 = 22 segment`.

### Vị trí item (tổ hợp A-A-A)

| Item | Vị trí | Giây | Làn | Context |
|---|---|---|---|---|
| Booster | 360m | 13.6s | R | cross |
| **Gift** | **616m** | **21.2s** | L | bait |
| Booster | 1352m | 39.7s | R | cross |

Gift đặt ở **giữa P2** (50% của phase). Trước đây nó ở cuối P3 (~2150m = 93% quãng
đường) nên chỉ 3 va chạm là không tới nổi, hầu như không ai thấy. Ở giữa P2 còn hơn
1600m dư địa, chịu được tới 30 va chạm.

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

`gsx` **không dùng ở P3**: nó ép dịch đúng 1 làn trong 16m, ở 50 m/s là 0.32s cho
một việc cần 0.25s. Đây từng là nguyên nhân chính khiến map khó di chuyển.

Người thiết kế chỉ viết trật tự khối mong muốn. **Compiler tự sửa** để không thể
ghép lỗi: chèn nhịp nghỉ khi chuỗi dày sắp tràn, chặn làn khi làn đó sắp thành
hành lang an toàn, pad tới đúng độ dài, và chuẩn hoá đuôi phase về trạng thái
trung tính để ghép A/B/C bất kỳ cũng an toàn ở chỗ nối.

### Auto-widen (giãn hàng theo tốc độ)

Khối `wv(a, b)` viết ra là hai hàng cách 16m. Nhưng nếu segment đó nằm ở vùng
v > 45.7 m/s, compiler **tự tách nó thành 2 segment**, mỗi segment một hàng, để
khoảng cách thành 32m:

```
wv(2, 0) ở giây 35  →  1 segment, 2 hàng cách 16m
wv(2, 0) ở giây 50  →  2 segment, 2 hàng cách 32m   (tag "weave-wide")
```

Đuôi chuẩn hoá `phase-reset` cũng được giãn theo cùng luật, nên đuôi P3 dài 3 slot
thay vì 2. Việc giãn được tính vào ngân sách độ dài trước khi đặt khối, nên phase
vẫn ra đúng số segment đặc tả.

Lợi ích: designer viết nhịp giống nhau cho cả 3 phase, ràng buộc tốc độ do một chỗ
duy nhất trong code lo. Trước đây phải có một khối riêng `wv2` và người viết beats
phải tự nhớ dùng nó ở nửa sau P3 — dễ sai và đã sai.

### Context đặt item

| Context | Cách hoạt động |
|---|---|
| `cross` | Gate ép về một làn → 32m sau item ở làn đối diện → chặn lại làn item |
| `gauntlet` | Chặn làn L → 32m sau item ở chính làn L → chặn lại làn L |
| `bait` | Item trống trải → 16m sau gate mở ở làn kề, buộc rời ngay |

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
| 14 | **Item nằm trong tầm với sau 5 va chạm** |
| 15 | Map phủ 60s + dự phòng boost |
| 16 | Ngân sách boost ≤ 20% |
| 17 | **Cửa sổ boost né được ở 1.35× tốc độ** |

Rule 14 sinh ra từ một lỗi thật: 15 rule đầu đều đạt mà quà vẫn không ai thấy được,
vì rule 6 chỉ kiểm hình học (*có kịp đổi làn tới quà không*) mà không hỏi câu quan
trọng hơn — người chơi có **đi tới được chỗ đó** không. Rule 14 mô phỏng quãng đường
còn lại sau 5 va chạm và yêu cầu mọi item nằm trong đó.

**Rule 2** chỉ xét phần map trong 2300m đầu (60 giây thực). Đoạn sau đó là dự phòng
boost — người chơi chỉ tới nếu đã ăn cả hai booster, và tốc độ ở đó là ngoại suy
ngoài `SPEED_LEVELS` nên đo bằng luật này không có nghĩa.

**Rule 9 đo obs/giây, không phải obs/segment.** obs/segment là thước đo sai ở phase
cuối: tốc độ 45–50 m/s buộc các hàng giãn từ 16m lên 32m, nên số vật cản trên mỗi
32m tất yếu giảm dù áp lực thực tế tăng. Cái người chơi cảm nhận là số vật cản phải
xử lý trong một giây — và ở P3 xe đi nhanh gấp đôi P1:

| Phase | obs/giây | obs/segment |
|---|---|---|
| P1 | 0.88 | 1.13 |
| P2 | 1.50 | 1.36 |
| P3 | 1.69 – 1.86 | 1.18 – 1.30 |

### Lint thư viện

Chạy trước khi ghép, bắt lỗi do sửa tay:

- 3 biến thể cùng độ dài, cùng kết thúc bằng segment trống
- mọi cặp hàng trong biến thể đều né được ở tốc độ **tệ nhất** phase đó có thể gặp
- đủ item theo đặc tả phase
- **ranh giới phase khớp mốc thời gian** trong sai số 1.5s
- **gift nằm trong 30–70% của P2**

Hai luật cuối sinh ra sau khi tăng độ dài P2 làm phase tràn sang 36.5s và kéo P3
lệch theo.

---

## Pattern pool cho Unity

Unity bốc pattern **độc lập từng segment**: `tier` = `activeTime` lớn nhất ≤ `gameTime`,
rồi bốc 1 pattern trong tier đó. Hai pattern bất kỳ trong cùng tier đều có thể nằm
kề nhau, nên pool phải an toàn với **mọi cặp**.

### Luật pool

| # | Luật | Lý do |
|---|---|---|
| R1 | Không hàng nào bịt cả 3 làn | không có đường đi |
| R2 | Hàng y=+8 không được chỉ mở một làn **biên** | nếu không sẽ tồn tại cặp mở{L} → mở{R} cách 16m, cần 0.5s mà chỉ có 0.32s |
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

Tổng 32 pattern riêng biệt, xuất ra 6 tier / 109 entry (pattern tier trước lặp lại
ở tier sau, đúng như `app.ts` mong đợi).

### Kiểm chứng

- **1024 cặp** pattern kề nhau, tất cả né được ở 50 m/s
- **500 seed** mô phỏng đúng pipeline `app.ts`: SFC32 PRNG, chọn tier theo thời
  gian, luật anti safe-lane streak ≤ 2

### Sửa pool

Mảng `POOL` trong `unity_patterns.js`:

```js
single(lane)   // 1 vật cản
gate(open)     // chặn 2 làn, chỉ mở `open`
oilRow(lane)   // vũng dầu
```

Khai báo `P(tên, hàng_y−8, hàng_y+8, tier)`. Sửa xong chạy
`node export_unity.js --check`.

---

## Oil cần quyết một lần

Oil gây `slipping` 1.0s, nhưng runway tối đa một pattern **tự đảm bảo** được chỉ là
32m (oil ở y=−8, y=+8 trống). Ở 50 m/s đó là 0.64s < 1.0s.

Không thể chừa thêm vì pattern kế tiếp do Unity bốc độc lập — đây là giới hạn kiến
trúc, không phải lỗi soạn pattern. Chọn một trong hai, cả hai đã kiểm chứng 100%:

| | Cách | Lệnh |
|---|---|---|
| **A** (mặc định) | Giữ oil mọi tier, sửa `init_data.json`: `carState.slipping.activeDuration = 0.64` | `node export_unity.js` |
| **B** | Giữ `slipping = 1.0`, oil chỉ ở tier có speed ≤ 32 m/s (activeTime < 14s) | `node export_unity.js --oil-early` |

Phương án B giảm pool ở các tier nhanh: `20s: 21→18`, `30s: 28→25`, `45s: 32→29`.

Panel Unity Export trên web có radio để xem trước cả hai.

---

## Booster và gift

Schema `roadPathPatternInfos` của Unity không có chỗ cho item, nên
`node export_unity.js --items` xuất riêng `items.json` với `distanceY` (world Y) và
`x` (làn) cho cả 27 tổ hợp. Spawn bằng hệ thống riêng.

Công thức: `worldY = segment × 32 + 16 + localY`.

### Cơ chế booster: 2 lượt xuyên, không bất tử

Booster **không** cho bay qua mọi thứ trong 5 giây. Nó cấp:

- tốc độ ×1.35 trong 5 giây
- **2 lượt xuyên** (`BOOST_PASS`): xuyên qua 2 vật cản đầu tiên, mỗi lần +80 điểm

Từ vật cản **thứ 3** trở đi, va vào là **mất luôn effect** và ăn đủ hình phạt như
bình thường — `collided` 2.5s ở 0.25× tốc độ, hoặc `slipping` nếu là oil. Lượt xuyên
không để dành được: hết 5 giây là mất, dù chưa dùng. Ăn booster thứ hai thì nạp lại
đủ 2 lượt.

Lý do đổi: bất tử 5 giây ở P3 là bỏ qua gần như toàn bộ đoạn khó nhất, làm hai
booster thành nút "thắng" chứ không phải phần thưởng. Giới hạn số lần xuyên biến nó
thành tài nguyên phải tiêu dè — người chơi vẫn phải lái trong lúc boost.

HUD hiện `⚡` kèm thời gian còn lại và hai chấm: chấm đầy = lượt còn dùng được, chấm
rỗng = đã tiêu. Hết lượt thì báo "hết lượt xuyên" màu đỏ.

Đây là cơ chế **chỉ có ở client** — `app.ts` không mô hình hoá booster, `CarStates`
chỉ có `moving` / `slipping` / `collided`.

**Ràng buộc kéo theo (rule 17).** Boost làm v ×1.35, nên hàng cách 16m ở cuối map chỉ
còn `16 / (50 × 1.35) = 0.237s` — **ít hơn** 0.25s cần để đổi một làn. Khi booster
còn là bất tử thì điều đó vô hại. Giờ thì không: nếu cửa sổ 5 giây boost chứa một
hàng như vậy, người chơi buộc phải tiêu lượt xuyên dù lái đúng, và phần thưởng thành
cái bẫy. Rule 17 mô phỏng quãng đường đi được trong 5 giây kể từ mỗi booster và kiểm
mọi hàng trong đó ở tốc độ đã nhân boost. Hiện 27/27 tổ hợp sạch.

---

## Web tool

Mở `index.html`. Cột trái là dữ liệu, cột phải là chơi thử.

### Ba tab

| Tab | Nội dung |
|---|---|
| **Map** | Strip thống kê, sơ đồ map, validator, item placement, obstacle, spawn list |
| **Thiết kế** | Phase/difficulty curve, variant library, speed levels, config đầy đủ |
| **Unity Export** | Pattern pool (kèm sơ đồ + toạ độ), tier, luật pool, JSON preview |

Bảng dài có ô lọc và header dính khi cuộn. Bảng pattern hiện sơ đồ 3 làn × 2 hàng
kèm toạ độ `x, y` đúng thứ tự Unity sort, copy vào là khớp.

Panel Unity Export có nút **Lint** (kiểm R1–R4 + 1024 cặp), **Mô phỏng 500 seed**,
**Copy JSON**, **Tải file**.

### Chơi thử

| Thao tác | Việc |
|---|---|
| **Kéo** chuột hoặc ngón tay | lái tự do, xe đi theo con trỏ |
| **Chạm nhanh** nửa trái/phải | đổi 1 làn |
| `←` `→` hoặc `A` `D` | đổi 1 làn |
| `Space` | Play khi chưa chạy · Pause/Resume khi đang chạy · Chơi lại khi hết giờ |
| `P` hoặc `Esc` | Pause / Resume |
| `✕` | thoát phiên chơi, mở lại bảng dữ liệu |

Khi kéo, xe vẫn bị giới hạn `LATERAL_V = 14 m/s` và biên `±5.25m` đúng như Unity.
Drag chỉ đặt **đích đến**, xe đi tới đích qua cùng phép tính giới hạn tốc độ như khi
bấm phím — nên không thể lách qua vật cản nhanh hơn mức mà validator dùng để kiểm map.
Nhả tay thì xe snap về làn gần **đích** nhất (không phải gần vị trí hiện tại, vì xe
có thể chưa kịp đi tới).

Bấm tiếp tục sau pause sẽ **đếm ngược 3 giây** để kịp nhìn lại map; đồng hồ game
không chạy trong lúc đếm. Đổi biến thể A/B/C sẽ dựng map mới và về trạng thái chờ,
không tự chạy.

Trên mobile, bấm Play thì khung game ghim toàn màn hình và trang bị khóa cuộn, nên
kéo xe không bị nhầm thành cuộn trang.

### Trạng thái phiên chơi

```
idle → running ⇄ paused → countdown → running
                              ↓
                            over → running
```

Tách khỏi trạng thái xe (`moving` / `collided` / `slipping`).

---

## Quy trình sửa map

1. Sửa `PHASE_SPEC` trong `level_design.js` (bố cục) hoặc `POOL` trong
   `unity_patterns.js` (pattern cho Unity)
2. `node check_levels.js` — lint + 27 tổ hợp
3. `node export_unity.js --check` — luật pool + 1024 cặp + 500 seed
4. `node export_unity.js` — ghi file khi đã sạch
5. Mở `index.html` chơi thử để cảm nhận

Nếu lint báo *"khối bị cắt vì thiếu chỗ"* thì **bớt beats**, đừng tăng `len` — tăng
`len` sẽ làm ranh giới phase lệch khỏi mốc thời gian và lint sẽ báo lỗi khác.
Lưu ý auto-widen: một khối `wv` ở nửa sau P3 chiếm 2 segment chứ không phải 1, nên
beats của P3 "tốn chỗ" nhiều hơn con số khối cho thấy.
Nếu báo *"phase kết thúc ở giây X"* thì `len` đã lệch khỏi mốc thời gian — thông báo
có kèm số segment cần thiết.

---

## Độ chặt của map

Map hợp lệ không có nghĩa là dễ chịu. Ba số đo dưới đây là thứ quyết định cảm giác
"khó di chuyển", đo trên cả 27 tổ hợp:

| Số đo | Ý nghĩa | Hiện tại |
|---|---|---|
| **Slack tối thiểu** | thời gian dư sau khi đã đổi làn xong | **0.118s** (7 frame @60fps) |
| **Tỉ lệ hàng 16m** | hàng chỉ cách hàng trước 16m | **35%** |
| **Hàng chỉ 1 làn mở** | không có lựa chọn, buộc vào đúng một chỗ | P1 13% · P2 36% · P3 33% |

Phân bố khoảng cách giữa các hàng (tổ hợp A-A-A): 16m × 24 · 32m × 32 · 48m × 7 ·
64m × 10 · 80m × 1.

Lần chỉnh gần nhất nhằm nới ba số này: slack tối thiểu từ 0.07s lên 0.118s, tỉ lệ
hàng 16m từ 60% xuống 35%, hàng 1 làn mở ở P2 từ 39% xuống 36%. Ba thay đổi tạo ra
kết quả đó:

1. `REACT_MARGIN` 1.15 → **1.4**
2. Bỏ `gsx` khỏi P3, thay bằng **chuỗi `gt` liên tiếp** (đổi làn mở mỗi lần) — cho
   2 vật cản/segment mà hàng vẫn cách 32m, tăng áp lực không bằng cách bóp thời gian
3. **Auto-widen** trong compiler, thay cho việc designer tự chọn khối giãn
