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
| Tốc độ ngang | 22 m/s ⇒ đổi 1 làn = **0.159s** |

Tốc độ ngang là lựa chọn của client, **không** phải ràng buộc server. `app.ts` chỉ giới
hạn `MAX_LATERAL_DELTA_PER_SNAPSHOT = 3.75m` trên mỗi snapshot 1m **đi tới**. Ở tốc độ
thấp nhất 20 m/s, 1m dọc mất 0.05s ⇒ trần lý thuyết là 75 m/s ngang. Với 22 m/s, dịch
ngang thực tế cao nhất là 1.10m/1m dọc — dưới 30% ngưỡng.

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

Chạy sạch không ăn booster = `2,299.75`. Tối đa lý thuyết ≈ `2,458`.

`2,299.75` chứ không phải `2,300` chẵn vì forward-Euler với `dt = 1/60` cho kết quả thấp
hơn tích phân chính xác một chút. Đây **không** phải lỗi — server dùng đúng phép tính đó,
nên hai bên khớp nhau. `BASE_DIST = 2300` trong `level_design.js` là giá trị tích phân
chính xác, chỉ dùng để tính độ dài map cần thiết.

### Điểm tất định — điều kiện để xếp hạng dùng được

Phần thập phân chỉ có nghĩa cho bảng xếp hạng nếu nó **không phụ thuộc máy người chơi**.
Hai yêu cầu, cả hai đã đạt:

**1. Fixed timestep `1/60s`.** `step()` chỉ được gọi với `dt = FIXED_DT = 1/60`, đúng
bằng `UNITY_FIXED_DELTA_TIME` trong `app.ts`. Vòng lặp tích luỹ thời gian thực rồi chạy
step theo bội số, phần dư giữ cho frame sau (accumulator). Vẽ vẫn theo frame rate máy.

Trước đây `step()` nhận `dt` biến thiên từ `requestAnimationFrame`, nên cùng một cách
chơi cho ra điểm khác nhau:

| Frame rate | Điểm (dt biến thiên) | Điểm (fixed timestep) |
|---|---|---|
| 30 fps | 2299.50 | **2299.75** |
| 60 fps | 2299.75 | **2299.75** |
| 120 fps | 2299.88 | **2299.75** |
| 240 fps | 2299.94 | **2299.75** |
| 60 fps + jitter | thay đổi | **2299.75** |

Chênh lệch cũ 0.13m — lớn hơn khác biệt giữa hai người chơi hơn nhau một frame (0.83m
thì còn thấy, nhưng 0.13m nhiễu làm phần thập phân vô nghĩa). Giờ chênh lệch là
**0.000000m** qua mọi frame rate.

**2. Thứ tự tích phân khớp server.** Tính tốc độ tại `G.t` hiện tại, cộng quãng đường,
*rồi mới* tăng `G.t` — đúng như `app.ts`:

```js
const v = getBaseSpeedAtTime(timeCursor) * multiplier
simulatedDistance += v * dt
timeCursor += dt
```

Bản trước tăng `G.t` trước rồi mới lấy `speedAt(G.t)`, lệch một frame mỗi bước, dồn lại
thành **1.33m** sau 60 giây. Sau khi sửa, client khớp `simulatedDistance` của server
**chính xác 0.000000m**, chứ không chỉ nằm dưới cận trên `allowedMaxDistance`.

### Vì sao mét chứ không phải km

Đơn vị nhỏ nhất có nghĩa là mét: một frame ở 50 m/s đi 0.83m. Với quãng 2300m, ghi km
cho ra `2.30` — quá thô để phân biệt người chơi, và `.05` sẽ mang nghĩa 50m thay vì 5cm.

Cả hệ thống cũng đã tính bằng mét (`m/s`, segment `32m`, collider `2.49m`), và `app.ts`
xác thực bằng `distance` theo mét. Hiển thị mét nghĩa là điểm và đại lượng server kiểm là
cùng một con số, không có phép quy đổi nào để sai.

Thang độ lớn để tham chiếu khi thiết kế bảng xếp hạng:

| Đại lượng | Độ lớn |
|---|---|
| Một booster | ~42 m |
| Một va chạm | ~10 m |
| Một frame @50 m/s | 0.83 m |
| Chênh lệch do frame rate | **0 m** |
| Dung sai anti-cheat (`sim × 1.01`) | 23 m |

---

## Nguyên lý thiết kế

### Lattice 16m

Vật cản chỉ đặt ở **local y = −8 hoặc +8** trong segment 32m. Nhờ đó khoảng cách giữa
hai hàng liền nhau luôn là bội số của 16m, kể cả khi vắt qua ranh giới segment. Bắt
buộc vì Unity bốc pattern **độc lập từng segment**, không biết segment trước có gì.

### Ngân sách thời gian

Thời gian có được giữa hai hàng, theo khoảng cách và tốc độ:

| Khoảng cách | @20 | @30 | @40 | @45 | @50 |
|---|---|---|---|---|---|
| **16m** | 0.80s | 0.53s | 0.40s | 0.36s | 0.32s |
| **32m** | 1.60s | 1.07s | 0.80s | 0.71s | 0.64s |

**Ngưỡng `MIN_ROW_GAP_TIME = 0.35s`.** Đủ thời gian *dịch làn* không có nghĩa là chơi
được — người chơi còn phải **nhận biết** hàng tiếp theo và quyết định. 0.35s là 21 frame
ở 60fps, trong đó việc đổi làn chỉ chiếm 0.159s.

Đây là ngưỡng **tuyệt đối**, không phải hệ số nhân thời gian đổi làn. Bản trước dùng
`LANE_TIME × 1.4`, nên khi tăng tốc độ ngang từ 14 lên 22 m/s thì ngưỡng tự tụt từ 0.35s
xuống 0.22s và auto-widen tắt hẳn — mất một lớp bảo vệ mà không ai thấy. Thời gian phản
ứng của người chơi không phụ thuộc xe dịch nhanh bao nhiêu, nên nó phải là hằng số.

Từ ngưỡng đó suy ra tốc độ tối đa mà hàng 16m còn dùng được:

```
16 / 0.35 = 45.7 m/s   →  khoảng giây 47 trở đi
```

Sau mốc này mọi hàng có vật cản buộc phải cách 32m. Compiler tự lo (xem *auto-widen*).
Đây cũng là lý do gate (chặn 2 làn, mở 1) luôn để hàng sau trống.

Cũng vì vậy pattern 4–5 vật cản đặt ở y = −11/−3/+3/+11 **không dùng được**: hàng cách
nhau 6–8m, tức 0.12–0.16s ở P3.

---

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

P1 dùng `sg` + `brt`, không dùng `gate` — 10 giây đầu ở 20–30 m/s chỉ để làm quen điều
khiển. P2 bỏ hết `gsx` và thay bớt `gate` bằng `sg`/`wv`.

Sàn cứng của mật độ là ~6 vật cản cho P1 và ~17 cho P2: `MAX_FREE_STREAK = 5` buộc mỗi
làn phải bị chặn ít nhất một lần trong mỗi 4 segment, cộng 3 vật cản của đuôi
`phase-reset`. Muốn thưa hơn nữa thì phải nới `MAX_FREE_STREAK`, nhưng điều đó mở đường
cho "hành lang an toàn" — người chơi giữ một làn suốt cả đoạn.

Tổng 80 segment = 2560m. Cả 27 tổ hợp đều ra 80 segment.

Độ dài phase khớp mốc thời gian: `distAtTime(30) − distAtTime(10) = 700m ÷ 32 = 22`.

### Vị trí item (tổ hợp A-A-A)

| Item | Vị trí | Giây | Làn | Context |
|---|---|---|---|---|
| Booster | 360m | 13.6s | R | cross |
| Gift | 648m | 22.1s | L | bait |
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

`gsx` hiện **không dùng ở đâu cả** — nó ép dịch đúng 1 làn trong 16m, ở 50 m/s là 0.32s
cho một việc cần 0.25s. Giữ lại trong DSL để dùng nếu cần một nhịp gắt có kiểm soát.
`gate` cũng không dùng ở P1.

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

Ba rule cần giải thích vì chúng không hiển nhiên:

**Rule 2** chỉ xét 2300m đầu. Đoạn sau là dự phòng boost — người chơi chỉ tới nếu đã ăn
cả hai booster, và tốc độ ở đó là ngoại suy ngoài `SPEED_LEVELS`.

**Rule 9 đo obs/giây, không phải obs/segment.** obs/segment là thước đo sai ở phase
cuối: tốc độ 45–50 m/s buộc hàng giãn từ 16m lên 32m, nên số vật cản trên mỗi 32m tất
yếu giảm dù áp lực thực tế tăng.

| Phase | obs/giây | obs/segment |
|---|---|---|
| P1 | 0.69 – 0.78 | 0.88 – 1.00 |
| P2 | 1.25 – 1.30 | 1.14 – 1.18 |
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
| **Xếp tay** | Lưới xếp map thủ công + validator trực tiếp (xem dưới) |
| **Unity Export** | Pattern pool (sơ đồ + toạ độ), tier, luật pool, JSON preview |

Bảng dài có ô lọc và header dính khi cuộn. Bảng pattern hiện sơ đồ 3 làn × 2 hàng kèm
toạ độ `x, y` đúng thứ tự Unity sort, copy vào là khớp. Panel Unity Export có nút
**Lint**, **Mô phỏng 500 seed**, **Copy JSON**, **Tải file**.

Thông số luật chơi (điểm, thời gian phạt, ramp, boost, độ nhạy lái) hiện ngay dưới khung
game.

### Tab Xếp tay

Lưới `segment × 2 hàng × 3 làn`. Bấm ô để đặt vật cản, giữ chuột kéo qua nhiều ô để tô
nhanh. Bấm lại đúng loại đang chọn thì xoá, không cần đổi sang bút xoá.

| Nút | Việc |
|---|---|
| **▶ Chơi map này** | đưa map tự xếp vào khung chơi thử bên phải |
| **⤓ Nạp từ combo** | nạp map A/B/C hiện tại vào lưới để sửa tiếp |
| **✕ Xoá hết** | về lưới trống |
| **+8 / −8 segment** | đổi độ dài map (tối thiểu 8) |
| **⧉ Copy / ⤒ Dán JSON** | lưu và chia sẻ bố cục |

Header mỗi hàng hiện `segment · worldY · thời gian`, nền phân màu theo phase, viền đậm
đánh dấu ranh giới mỗi 32m.

Map tự xếp **không đi qua compiler** — compiler tự sửa nên sẽ ghi đè ý người dùng. Thay
vào đó nó chạy qua **cùng hàm `validate()`** với map tự sinh, nên lỗi được báo bằng đúng
17 rule và cập nhật ngay khi nhả chuột. Lỗi được sắp lên đầu bảng. Số lỗi cũng hiện trên
nhãn tab.

Không có ràng buộc nào bị nới cho map tự xếp: bịt kín 3 làn, hai hàng 16m ở P3, item quá
xa — tất cả đều bị bắt như map tự sinh. Nút "Chơi map này" **không** kiểm lỗi trước, để
bạn thử map chưa hoàn thiện mà cảm nhận.

### Chơi thử

| Thao tác | Việc |
|---|---|
| **Kéo** chuột hoặc ngón tay | lái tự do, xe đi theo con trỏ |
| **Chạm nhanh** nửa trái/phải | đổi 1 làn |
| `←` `→` hoặc `A` `D` | đổi 1 làn |
| `Space` | Play khi chưa chạy · Pause/Resume khi đang chạy · Chơi lại khi hết giờ |
| `P` hoặc `Esc` | Pause / Resume |
| `✕` | thoát phiên chơi, mở lại bảng dữ liệu |

Khi kéo, xe vẫn bị giới hạn `LATERAL_V = 22 m/s` và biên `±5.25m` đúng như Unity. Drag
chỉ đặt **đích đến**, xe đi tới đích qua cùng phép giới hạn tốc độ như khi bấm phím —
nên không thể lách qua vật cản nhanh hơn mức validator dùng để kiểm map. Nhả tay thì xe
snap về làn gần **đích** nhất, không phải gần vị trí hiện tại.

**Độ nhạy kéo `DRAG_GAIN = 1.8`**: vuốt 1px màn hình cho ra 1.8px thế giới. Ở tỉ lệ 1:1
phải vuốt gần hết chiều rộng canvas mới đi từ làn trái sang phải, cảm giác lết; với 1.8
chỉ cần ~217px trên canvas 390px. Hệ số này chỉ đặt **đích**, không đổi tốc độ ngang thực
tế nên không ảnh hưởng anti-cheat.

Bấm tiếp tục sau pause sẽ **đếm ngược 3 giây**; đồng hồ game không chạy trong lúc đếm.
Đếm ngược dùng thời gian thực, không phải fixed timestep. Đổi biến thể A/B/C thì dựng map
mới và về trạng thái chờ, không tự chạy.

Vòng lặp chạy `step()` với `dt` cố định `1/60` (xem *Điểm tất định*), tối đa 5 bước mỗi
frame để không treo khi tab bị ngủ. Quá 5 bước thì bỏ phần nợ thời gian thay vì dồn tích —
tab ngủ 30 giây không làm xe nhảy 30 giây quãng đường.

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
| Slack tối thiểu | thời gian dư sau khi đã đổi làn xong | **0.209s** (13 frame @60fps) |
| Tỉ lệ hàng 16m | hàng chỉ cách hàng trước 16m | **32%** |
| Hàng chỉ 1 làn mở | không có lựa chọn, buộc vào đúng một chỗ | **30%** |

Phân bố khoảng cách giữa các hàng (A-A-A): 16m × 19 · 32m × 31 · 48m × 8 · 64m × 11 ·
80m × 1. Tổng 71 hàng có vật cản.

Nếu map trở nên khó di chuyển, ba đòn hiệu quả nhất theo thứ tự:

1. Tăng `MIN_ROW_GAP_TIME` (hiện 0.35s) — buộc mọi hàng giãn ra ở tốc độ cao
2. Thay `gsx` bằng chuỗi `gt` liên tiếp — vẫn 2 vật cản/segment nhưng hàng cách 32m,
   tăng áp lực không bằng cách bóp thời gian phản xạ
3. Giảm tỉ lệ hàng chỉ 1 làn mở, bằng cách đổi một số `gt` thành `sg` hoặc `wv`
