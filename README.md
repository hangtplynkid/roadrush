# Road Rush — Level Design

Bộ công cụ thiết kế map cho game runner 3 làn, 60 giây. Sinh ra
`road_path_patterns.json` để Unity dùng trực tiếp.

## Chạy

```bash
node export_unity.js            # kiểm tra + ghi road_path_patterns.json (backup .bak)
node export_unity.js --check    # chỉ kiểm tra, không ghi
node export_unity.js --oil-early # phương án B cho oil (xem bên dưới)
node export_unity.js --items    # ghi thêm items.json (booster/gift)
node check_levels.js            # kiểm tra 27 tổ hợp map A/B/C
```

Mở `index.html` để xem toàn bộ chỉ số và chơi thử. Panel **Unity Pattern Export**
ở cuối cột trái có nút lint, mô phỏng, copy và tải JSON.

Phím trong phần chơi thử:

| Thao tác | Việc |
|---|---|
| **Kéo** chuột hoặc ngón tay | lái tự do, xe đi theo con trỏ |
| **Chạm nhanh** nửa trái/phải | đổi 1 làn |
| `←` `→` hoặc `A` `D` | đổi 1 làn |
| `Space` | Play khi chưa chạy · Pause/Resume khi đang chạy · Chơi lại khi hết giờ |
| `P` hoặc `Esc` | Pause / Resume |

Khi kéo, xe vẫn bị giới hạn tốc độ ngang `LATERAL_V = 14 m/s` và biên đường
`CarLimitX = ±5.25m` đúng như Unity, nên không thể lách qua vật cản nhanh hơn
mức mà validator dùng để kiểm map. Nhả tay thì xe tự về tâm làn gần nhất.

Bấm tiếp tục sau khi pause sẽ đếm ngược 3 giây để kịp nhìn lại map. Đồng hồ game
không chạy trong lúc đếm ngược. Đổi biến thể A/B/C sẽ dựng map mới và về trạng
thái chờ, không tự chạy.

Exporter **không ghi file nếu có lỗi**, nên không thể đưa map hỏng vào Unity.

## File

| File | Vai trò |
|---|---|
| `level_design.js` | Config game, DSL, biến thể A/B/C, compiler, validator |
| `unity_patterns.js` | Pattern pool + luật + lint + mô phỏng pipeline Unity |
| `export_unity.js` | Sinh `road_path_patterns.json` |
| `check_levels.js` | Kiểm tra 27 tổ hợp |
| `index.html` | Bảng chỉ số + chơi thử |
| `road_path_patterns.json` | **File Unity đọc** (do exporter ghi ra) |
| `items.json` | Booster/gift theo `distanceY` (sinh bởi `--items`) |
| `app.ts`, `init_data.json` | Server và config của game (không sửa bởi tool) |

Sinh ra khi chạy, không cần commit: `road_path_patterns.json.bak`.

## Thiết kế

**Lattice.** Mỗi segment cao 32m, vật cản chỉ đặt ở local y = −8 hoặc +8. Nhờ đó
khoảng cách giữa hai hàng liền nhau luôn là bội số của 16m — kể cả khi vắt qua
ranh giới segment. Điều này quan trọng vì Unity bốc pattern độc lập từng segment,
không biết segment trước có gì.

**Ngân sách thời gian.** Xe dịch ngang 14 m/s nên đổi một làn mất 0.25s.

| Khoảng cách | @50 m/s | Đổi được |
|---|---|---|
| 16m | 0.32s | 1 làn |
| 32m | 0.64s | 2 làn |

**Luật pool.** Suy ra từ bảng trên:

- **R1** không hàng nào bịt cả 3 làn
- **R2** hàng y=+8 không được chỉ mở một làn biên — nếu không sẽ tồn tại cặp
  "mở L" → "mở R" cách 16m, cần 0.5s mà chỉ có 0.32s
- **R3** hai hàng trong cùng pattern lệch tối đa 1 làn
- **R4** oil đứng một mình trong segment (y=+8 trống) để có runway 32m

Vì Unity bốc ngẫu nhiên, exporter **vét cạn cả 1024 cặp** pattern kề nhau ở tốc
độ tối đa, rồi mô phỏng 500 lượt đúng pipeline `app.ts` (SFC32, chọn tier theo
thời gian, luật anti safe-lane streak ≤ 2).

## Tier

Tier cộng dồn giống `app.ts`: pattern của tier trước vẫn xuất hiện ở tier sau.

| Tier | Pattern | Max obs/segment | Speed | React/16m |
|---|---|---|---|---|
| ≥0s | 1 | 0 | 20 | 0.80s |
| ≥3s | 9 | 2 | 23 | 0.70s |
| ≥10s | 18 | 3 | 30 | 0.53s |
| ≥20s | 21 | 3 | 35 | 0.46s |
| ≥30s | 28 | 4 | 40 | 0.40s |
| ≥45s | 32 | 4 | 45 | 0.36s |

## Oil cần quyết một lần

Oil gây `slipping` 1.0s, nhưng runway tối đa một pattern tự đảm bảo được chỉ là
32m — ở 50 m/s là 0.64s. Không thể chừa thêm vì pattern kế tiếp do Unity bốc
độc lập. Đây là giới hạn kiến trúc, không phải lỗi soạn pattern. Chọn một trong hai:

- **A** (mặc định) — giữ oil ở mọi tier, sửa `init_data.json`:
  `carState.slipping.activeDuration = 0.64`
- **B** — giữ `slipping = 1.0`, chạy `--oil-early` để oil chỉ xuất hiện ở tier có
  speed ≤ 32 m/s (activeTime < 14s)

Cả hai đều đã kiểm chứng 100% qua mô phỏng.

## Booster và gift

Schema `roadPathPatternInfos` của Unity không có chỗ cho item, nên
`node export_unity.js --items` xuất riêng `items.json` với `distanceY` (world Y)
và `x` (làn) cho cả 27 tổ hợp map. Spawn bằng hệ thống riêng.

## Sửa map

Pattern pool nằm ở mảng `POOL` trong `unity_patterns.js`. Ba helper:

```js
single(lane)   // 1 vật cản
gate(open)     // chặn 2 làn, chỉ mở `open`
oilRow(lane)   // vũng dầu
```

Khai báo `P(tên, hàng_y−8, hàng_y+8, tier)`. Sửa xong chạy
`node export_unity.js --check` để lint bắt lỗi trước khi ghi.

Bố cục map A/B/C nằm ở `PHASE_SPEC` trong `level_design.js`, kiểm tra bằng
`node check_levels.js`.
