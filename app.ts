import express, {NextFunction, Request, Response} from 'express';
import {performance} from 'perf_hooks';
import {randomBytes} from 'node:crypto';
import rawRoadPathPatterns from './road_path_patterns.json';
import initData from './init_data.json';

// --- BỘ SINH SỐ NGẪU NHIÊN ĐỒNG BỘ SERVER-CLIENT ---
class SFC32Random {
    private a!: number;
    private b!: number;
    private c!: number;
    private d!: number;

    constructor(seed: number | Buffer | Uint8Array) {
        if (typeof seed === 'number') {
            // Khởi tạo bằng số nguyên (32-bit uint) giống phiên bản cũ hoặc Constructor(uint) C#
            this.a = (seed ^ 0x55555555) >>> 0;
            this.b = (seed ^ 0xAAAAAAAA) >>> 0;
            this.c = (seed ^ 0x33333333) >>> 0;
            this.d = 1;
        } else {
            // Khởi tạo bằng mảng 16 bytes (128-bit) giống Constructor(byte[]) C#
            if (seed.length !== 16) {
                throw new Error("Seed must be exactly 16 bytes (128 bits).");
            }

            // Đọc 4 số uint (32-bit) theo chuẩn Little Endian tương tự BinaryPrimitives.ReadUInt32LittleEndian
            if (Buffer.isBuffer(seed)) {
                this.a = seed.readUInt32LE(0);
                this.b = seed.readUInt32LE(4);
                this.c = seed.readUInt32LE(8);
                this.d = seed.readUInt32LE(12);
            } else {
                // Hỗ trợ trường hợp truyền vào Uint8Array
                const view = new DataView(seed.buffer, seed.byteOffset, seed.byteLength);
                this.a = view.getUint32(0, true);
                this.b = view.getUint32(4, true);
                this.c = view.getUint32(8, true);
                this.d = view.getUint32(12, true);
            }
        }

        // Chạy burn-in 12 vòng để trộn đều trạng thái hạt giống
        for (let i = 0; i < 12; i++) {
            this.nextUint();
        }
    }

    private nextUint(): number {
        const tmp = (this.a + this.b + this.d) >>> 0;
        this.a = (this.b ^ (this.b >>> 9)) >>> 0;
        this.b = (this.c + (this.c << 3)) >>> 0;
        this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
        this.d = (tmp + this.d) >>> 0;
        return tmp;
    }

    public next(min: number, max: number): number {
        const randomUint = this.nextUint();
        const range = max - min + 1;
        return min + (randomUint % range);
    }
}

function mathfRoundToInt(value: number): number {
    const fraction = value - Math.floor(value);
    if (Math.abs(fraction - 0.5) < 1e-9) {
        const floor = Math.floor(value);
        return floor % 2 === 0 ? floor : floor + 1;
    }
    return Math.round(value);
}

// --- ĐỊNH NGHĨA KIỂU DỮ LIỆU CẤU TRÚC MAP VÀ XE ---
interface Vector2 {
    x: number;
    y: number;
}

interface size {
    width: number;
    height: number;
}

interface obstacle {
    obstacleId: string;
    obstacleType: string;
    activeTime: number;
    size: size;
}

interface roadPath {
    roadPathId: string;
    obstacles: string[];
    spawnAmount: number;
    size: size;
    obstaclePositions: Vector2[];
}

const OBSTACLE: obstacle[] = [
    {obstacleId: "oil", obstacleType: "Oil", activeTime: 15, size: {width: 3.28, height: 2.33}},
    {obstacleId: "fence", obstacleType: "Normal", activeTime: 5, size: {width: 3.51, height: 2.64}},
    {obstacleId: "cone", obstacleType: "Normal", activeTime: 5, size: {width: 1.9, height: 2.41}},
    {obstacleId: "tire", obstacleType: "Normal", activeTime: 5, size: {width: 3.3, height: 2.57}}
];

const ROAD_PATHS: roadPath[] = [
    {
        roadPathId: "path_0",
        obstacles: ["oil", "fence", "cone", "tire"],
        spawnAmount: 2,
        size: {width: 16, height: 32},
        obstaclePositions: [
            {x: 0, y: 12}, {x: -3.5, y: 12}, {x: 3.5, y: 12},
            {x: 0, y: -12}, {x: -3.5, y: -12}, {x: 3.5, y: -12}
        ]
    },
    {
        roadPathId: "path_1",
        obstacles: ["oil", "fence", "cone", "tire"],
        spawnAmount: 3,
        size: {width: 16, height: 32},
        obstaclePositions: [
            {x: 0, y: 12}, {x: -3.5, y: 12}, {x: 3.5, y: 12},
            {x: 0, y: -12}, {x: -3.5, y: -12}, {x: 3.5, y: -12}
        ]
    },
    {
        roadPathId: "path_2",
        obstacles: ["oil", "fence", "cone", "tire"],
        spawnAmount: 4,
        size: {width: 16, height: 32},
        obstaclePositions: [
            {x: 0, y: 12}, {x: -3.5, y: 12}, {x: 3.5, y: 12},
            {x: 0, y: -12}, {x: -3.5, y: -12}, {x: 3.5, y: -12}
        ]
    }
];

const OBSTACLE_MAP = new Map<string, obstacle>(OBSTACLE.map(o => [o.obstacleId, o]));
const ROAD_PATHS_MAP = new Map<string, roadPath>(ROAD_PATHS.map(r => [r.roadPathId, r]));

interface ObstacleSpawnInfo {
    obstacleId: string;
    // Tọa độ cục bộ của bẫy bên trong roadpath (theo pattern), thay cho positionIndex cũ.
    x: number;
    y: number;
}

interface RoadSpawnInfo {
    roadPathId: string;
    obstacles: ObstacleSpawnInfo[];
}

// --- DỮ LIỆU PATTERN (đồng bộ với _roadPathPatternInfos phía Unity) ---
interface PatternObstacleData {
    obstacleType: string;
    position: Vector2;
}

interface PatternData {
    patternName: string;
    obstacles: PatternObstacleData[];
}

interface RoadPathPatternInfoData {
    activeTime: number;
    patterns: PatternData[];
}

interface RoadPathPatternsFile {
    roadPathPatternInfos: RoadPathPatternInfoData[];
}

// Chuẩn hóa & sắp xếp tất định các tier pattern để KHỚP CHÍNH XÁC với Client:
//  - Tier sắp xếp theo activeTime tăng dần.
//  - Bẫy trong mỗi pattern sắp xếp theo (y tăng, rồi x tăng) -> khớp GetSortedObstacleLayouts() bên Unity.
const PATTERN_TIERS: RoadPathPatternInfoData[] = (() => {
    const file = rawRoadPathPatterns as RoadPathPatternsFile;
    const tiers = (file.roadPathPatternInfos ?? []).map(tier => ({
        activeTime: tier.activeTime,
        patterns: (tier.patterns ?? []).map(pattern => ({
            patternName: pattern.patternName,
            obstacles: [...(pattern.obstacles ?? [])].sort((a, b) => {
                if (a.position.y !== b.position.y) return a.position.y - b.position.y;
                return a.position.x - b.position.x;
            })
        }))
    }));
    tiers.sort((a, b) => a.activeTime - b.activeTime);
    return tiers;
})();

// Chọn tier pattern tất định theo thời gian: tier có activeTime lớn nhất mà vẫn <= gameTime (-1 nếu chưa có).
function selectPatternTierIndex(gameTime: number): number {
    let tierIndex = -1;
    for (let i = 0; i < PATTERN_TIERS.length; i++) {
        if (gameTime >= PATTERN_TIERS[i].activeTime) tierIndex = i;
        else break;
    }
    return tierIndex;
}

// --- RÀNG BUỘC CHỐNG "ĐƯỜNG THẲNG AN TOÀN KÉO DÀI" ---
// Map có 3 làn cố định theo trục X: -3.5, 0, 3.5. Một làn bị "chặn" trong một đoạn nếu pattern
// của đoạn đó đặt ít nhất một vật cản đúng làn ấy. Nếu một làn trống LIÊN TỤC qua nhiều đoạn thì
// tạo thành hành lang an toàn thẳng tắp -> người chơi/bot chỉ cần giữ nguyên làn là không bao giờ
// dính bẫy. Ta theo dõi số đoạn trống liên tiếp của mỗi làn và ép chèn bẫy để phá vỡ khi vượt ngưỡng.
// Toàn bộ logic dưới đây phải TẤT ĐỊNH và trùng khớp tuyệt đối với Client (RoadsController.cs)
// để chuỗi rút PRNG không bị lệch pha.
const LANE_XS: number[] = [-3.5, 0.0, 3.5]; // = [-LANE_CENTER_DISTANCE, 0, LANE_CENTER_DISTANCE]
const LANE_MATCH_TOLERANCE = 0.01;
const MAX_SAFE_LANE_STREAK = 2; // Số đoạn tối đa một làn được phép trống liên tiếp trước khi bị ép chèn bẫy.

// Xác định các làn bị pattern chặn dựa trên tọa độ X của vật cản (chỉ phụ thuộc layout pattern,
// không phụ thuộc việc rút ngẫu nhiên id vật cản normal nên tính được trước khi sinh vật cản).
function getPatternBlockedLanes(obstacleXs: number[]): boolean[] {
    const blocked = [false, false, false];
    for (const x of obstacleXs) {
        for (let l = 0; l < LANE_XS.length; l++) {
            if (Math.abs(x - LANE_XS[l]) <= LANE_MATCH_TOLERANCE) blocked[l] = true;
        }
    }
    return blocked;
}

interface GameSession {
    sessionId: string;
    mapSeed: string;
    startTime: number;
    isValidated: boolean;
}

interface SpeedLevel {
    activeTime: number;
    speed: number;
}

const SPEED_LEVELS: SpeedLevel[] = [
    {activeTime: 0, speed: 20},
    {activeTime: 10, speed: 30},
    {activeTime: 30, speed: 40},
    {activeTime: 60, speed: 50}
];

interface CarState {
    stateId: string;
    activeDuration: number;
    speedMultiplier: number;
}

// LƯU Ý: phải khớp tuyệt đối với carState trong init_data.json và với client.
// collided đổi từ 2.5s x 0.25 sang 0.6s x 0.55. Hình phạt cũ quá lâu: ở 40 m/s mất
// 75m, và 2.5 giây bò ở 1/4 tốc độ khiến người chơi cảm giác mất kiểm soát chứ
// không phải bị phạt.
// Client còn có thêm ramp hồi phục 0.5s sau khi hết state (tổng 1.1s xe không đủ
// tốc); server KHÔNG mô phỏng ramp đó, nhưng ramp chỉ làm client CHẬM hơn nên
// distance vẫn nằm dưới allowedMaxDistance — không cần sửa gì thêm ở đây.
const CarStates: CarState[] = [
    {stateId: "moving", activeDuration: -1, speedMultiplier: 1.0},
    {stateId: "slipping", activeDuration: 1.0, speedMultiplier: 1.0},
    {stateId: "collided", activeDuration: 0.6, speedMultiplier: 0.55}
];

const CarSize: size = {width: 2.49, height: 3.965};
const CarStartLocalPosition: Vector2 = {x: 0, y: -6.28};

// GIỚI HẠN DI CHUYỂN TRÁI PHẢI (BIÊN ĐƯỜNG ĐUA)
const CarLimitX: number = 5.25;
const CAR_X_TOLERANCE: number = 0.01; // Dung sai xử lý sai số dấu câu động float từ Client truyền lên

// KHOẢNG CÁCH GIỮA TÂM HAI LÀN LIỀN KỀ trên map hiện tại: X = -3.5, 0.0, 3.5.
const LANE_CENTER_DISTANCE: number = 3.5;
// Dung sai hình học cho sai số float và thời điểm trigger của snapshot.
const LATERAL_MAP_TOLERANCE: number = 0.25;

// Khoảng cách dọc CỐ ĐỊNH giữa 2 snapshot liên tiếp (mỗi sensor cách nhau 1m theo trục Y).
const SNAP_DISTANCE: number = 1.0;

// NGƯỠNG DỊCH NGANG TỐI ĐA GIỮA 2 SNAPSHOT — HẰNG SỐ THEO HÌNH HỌC 3 LÀN.
// Cho phép đổi tối đa một làn (3.5m) + dung sai 0.25m.
// Không phụ thuộc CarState, speedMultiplier, timeCursor hoặc dtSensor.
const MAX_LATERAL_DELTA_PER_SNAPSHOT: number =
    LANE_CENTER_DISTANCE + LATERAL_MAP_TOLERANCE; // 3.75m

interface TrapPassPayload {
    i: number;
    x: number;
}

interface BatchValidationRequest {
    sessionId: string;
    distance: number;
    totalPauseDuration: number;
    trapDataArray: TrapPassPayload[];
}

const GAME_TIME = 60;
const ROAD_PATH_HEIGHT = 32;

// BƯỚC THỜI GIAN MÔ PHỎNG — PHẢI KHỚP VỚI UPDATE LOOP CỦA UNITY.
// Client đặt Application.targetFrameRate = 60 (GameplayController.Awake), và mỗi frame
// xe di chuyển bằng CurrentSpeed * multiplier * Time.deltaTime (CarController.MoveForward).
// Server tái hiện chính xác bằng forward-Euler với dt cố định = 1/60s.
const UNITY_FIXED_DELTA_TIME: number = 1 / 60;

function parseBase64UrlToBytes(base64Url: string): Buffer {
    // 1. Thay thế các ký tự đặc biệt của Base64Url về lại Base64 tiêu chuẩn
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

    // 2. Thêm lại padding '=' nếu thiếu (độ dài chuỗi Base64 luôn chia hết cho 4)
    const pad = base64.length % 4;
    if (pad > 0) {
        base64 += '='.repeat(4 - pad);
    }

    // 3. Convert chuỗi Base64 tiêu chuẩn sang Buffer
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length !== 16) {
        throw new Error(`Seed bytes length is invalid. Expected 16 bytes, got ${buffer.length} bytes.`);
    }

    return buffer;
}

// --- TIỆN ÍCH DỰNG BẢN ĐỒ LÝ THUYẾT ---
function generateRandomSeed(): string {
    return randomBytes(16).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function calculateMaxPossibleDistance(): number {
    let totalDistance = 0;
    for (let i = 0; i < SPEED_LEVELS.length; i++) {
        const current = SPEED_LEVELS[i];
        const next = SPEED_LEVELS[i + 1];
        const startTime = current.activeTime;
        const endTime = next ? Math.min(next.activeTime, GAME_TIME) : GAME_TIME;
        if (startTime >= GAME_TIME) break;
        const duration = endTime - startTime;
        if (next) {
            const vEnd = current.speed + (next.speed - current.speed) * (duration / (next.activeTime - current.activeTime));
            totalDistance += (current.speed + vEnd) / 2 * duration;
        } else {
            totalDistance += current.speed * duration;
        }
    }
    return totalDistance;
}

function calculateRequiredSpawnCount(): number {
    return Math.ceil((calculateMaxPossibleDistance() / ROAD_PATH_HEIGHT) * 1.2);
}

function calculateTimeForDistanceDeterministic(distance: number): number {
    let currentDistance = 0;
    let accumulatedTime = 0;
    for (let i = 0; i < SPEED_LEVELS.length; i++) {
        const current = SPEED_LEVELS[i];
        const next = SPEED_LEVELS[i + 1];
        const startTime = current.activeTime;
        const endTime = next ? Math.min(next.activeTime, GAME_TIME) : GAME_TIME;
        if (startTime >= GAME_TIME) break;

        const duration = endTime - startTime;
        let segmentDistance = 0;
        let isAccelerating = false;
        let vEnd = current.speed;

        if (next) {
            vEnd = current.speed + (next.speed - current.speed) * (duration / (next.activeTime - current.activeTime));
            segmentDistance = ((current.speed + vEnd) / 2) * duration;
            isAccelerating = true;
        } else {
            segmentDistance = current.speed * duration;
        }

        if (currentDistance + segmentDistance >= distance) {
            const targetDistanceInSegment = distance - currentDistance;
            if (isAccelerating) {
                const a = (vEnd - current.speed) / duration;
                if (a === 0) return accumulatedTime + targetDistanceInSegment / current.speed;
                const delta = current.speed * current.speed + 2 * a * targetDistanceInSegment;
                return accumulatedTime + (-current.speed + Math.sqrt(delta)) / a;
            } else {
                return accumulatedTime + targetDistanceInSegment / current.speed;
            }
        }
        currentDistance += segmentDistance;
        accumulatedTime += duration;
    }
    return GAME_TIME;
}

function generateSpawnListDeterministic(seedBytes: Buffer): RoadSpawnInfo[] {
    const prng = new SFC32Random(seedBytes);
    const spawnCount = calculateRequiredSpawnCount();
    const spawnList: RoadSpawnInfo[] = [];
    let accumulatedDistance = 0;

    // Số đoạn trống liên tiếp của từng làn [-3.5, 0, 3.5]; dùng để phá hành lang an toàn kéo dài.
    const laneFreeStreak = [0, 0, 0];

    console.log(`\n\x1b[36m[BẢN ĐỒ] --- TÁI CẤU TRÚC ĐƯỜNG ĐI ĐƯỢC SINH TỪ BYTE SEED: [${seedBytes.join(', ')}] ---\x1b[0m`);

    for (let i = 0; i < spawnCount; i++) {
        // 1) Chọn biến thể đường (hình ảnh) - LUÔN rút random để khớp chuỗi PRNG với Client.
        const roadPathIndex = prng.next(0, ROAD_PATHS.length - 1);
        const roadPath = ROAD_PATHS[roadPathIndex];
        const estimatedGameTime = calculateTimeForDistanceDeterministic(accumulatedDistance);
        const obstacles: ObstacleSpawnInfo[] = [];
        let selectedPatternName = 'NONE';

        // 2) Chọn tier pattern theo thời gian; nếu chưa có tier / tier rỗng -> không bẫy, KHÔNG rút thêm random.
        const tierIndex = selectPatternTierIndex(estimatedGameTime);
        if (tierIndex >= 0 && PATTERN_TIERS[tierIndex].patterns.length > 0) {
            // 3) Chọn pattern trong tier (LUÔN rút random trước, kể cả tier chỉ có 1 pattern).
            const tierPatterns = PATTERN_TIERS[tierIndex].patterns;
            let patternIndex = prng.next(0, tierPatterns.length - 1);

            // 3b) Chống hành lang an toàn kéo dài: nếu có làn đã trống liên tiếp tới ngưỡng
            //     (MAX_SAFE_LANE_STREAK), ưu tiên pattern chặn được NHIỀU làn rủi ro nhất. Chỉ khi
            //     tồn tại pattern như vậy mới rút THÊM 1 random để chọn trong danh sách ứng viên
            //     (đồng bộ tuyệt đối với Client). Trường hợp phổ biến (không có làn rủi ro) giữ
            //     nguyên chuỗi PRNG như cũ.
            const requiredLanes = LANE_XS.map((_, l) => laneFreeStreak[l] >= MAX_SAFE_LANE_STREAK);
            if (requiredLanes.some(r => r)) {
                const scoreOf = (p: number): number => {
                    const blk = getPatternBlockedLanes(tierPatterns[p].obstacles.map(o => o.position.x));
                    let s = 0;
                    for (let l = 0; l < LANE_XS.length; l++) if (requiredLanes[l] && blk[l]) s++;
                    return s;
                };
                let bestScore = 0;
                for (let p = 0; p < tierPatterns.length; p++) bestScore = Math.max(bestScore, scoreOf(p));
                if (bestScore > 0) {
                    const candidates: number[] = [];
                    for (let p = 0; p < tierPatterns.length; p++) if (scoreOf(p) === bestScore) candidates.push(p);
                    patternIndex = candidates[prng.next(0, candidates.length - 1)];
                }
            }

            const pattern = tierPatterns[patternIndex];
            selectedPatternName = pattern.patternName;

            // 4) Pool vật cản của roadpath: giữ NGUYÊN thứ tự mảng roadPath.obstacles để khớp Client.
            const normalPool = roadPath.obstacles.filter(id => {
                const cfg = OBSTACLE_MAP.get(id);
                return cfg ? cfg.obstacleType.toLowerCase() === 'normal' : false;
            });
            const oilId = roadPath.obstacles.find(id => {
                const cfg = OBSTACLE_MAP.get(id);
                return cfg ? cfg.obstacleType.toLowerCase() === 'oil' : false;
            });

            // 5) Với mỗi bẫy trong pattern (đã sắp xếp tất định): 'oil' lấy trực tiếp, 'normal' rút random từ pool.
            for (const pObs of pattern.obstacles) {
                let obstacleId: string;
                if (pObs.obstacleType.toLowerCase() === 'oil') {
                    if (!oilId) continue; // Không có bẫy oil -> bỏ qua, KHÔNG rút random.
                    obstacleId = oilId;
                } else {
                    if (normalPool.length === 0) continue; // Không có bẫy normal -> bỏ qua, KHÔNG rút random.
                    const normalIndex = prng.next(0, normalPool.length - 1);
                    obstacleId = normalPool[normalIndex];
                }

                obstacles.push({obstacleId, x: pObs.position.x, y: pObs.position.y});
            }

            // 6) Cập nhật streak: làn bị pattern chặn -> reset 0, làn còn trống -> +1.
            const patternBlocked = getPatternBlockedLanes(pattern.obstacles.map(o => o.position.x));
            for (let l = 0; l < LANE_XS.length; l++) {
                laneFreeStreak[l] = patternBlocked[l] ? 0 : laneFreeStreak[l] + 1;
            }
        } else {
            // Không có pattern (warm-up / tier rỗng) -> cả 3 làn đều trống trong đoạn này.
            for (let l = 0; l < LANE_XS.length; l++) laneFreeStreak[l]++;
        }

        spawnList.push({roadPathId: roadPath.roadPathId, obstacles});

        const obsLogs = obstacles.map(o => `[ID Bẫy: ${o.obstacleId}, Vị trí: (${o.x}, ${o.y})]`).join(', ');
        console.log(`  + Đoạn số [${i}] | Cấu hình: \x1b[33m${roadPath.roadPathId}\x1b[0m | Pattern: \x1b[35m${selectedPatternName}\x1b[0m | Vật cản đã sinh: ${obsLogs || '\x1b[90m(Trống)\x1b[0m'}`);

        accumulatedDistance += roadPath.size.height;
    }
    console.log(`\x1b[36m[BẢO ĐỒ] --- HOÀN THÀNH DỰNG LẠI MA TRẬN BẢN ĐỒ ---\x1b[0m\n`);
    return spawnList;
}

// --- HÌNH HỌC COLLIDER THỰC TẾ (đồng bộ tuyệt đối với BoxCollider2D phía Unity) ---
// Client phát hiện va chạm bằng BoxCollider2D thật (size + offset), KHÔNG dùng kích thước sprite.
// Vì vậy server phải dùng ĐÚNG size + offset của collider để hình học trùng khớp. Giá trị dưới đây
// lấy trực tiếp từ prefab Unity (m_Size, m_Offset):
//   - Xe (StartScene / CarController): size 2.49 x 3.965, offset 0.
//   - oil 3.28 x 2.33 | fence 3.51 x 2.64 | cone 1.9 x 2.41 | tire 3.3 x 2.57 | tất cả offset 0.
interface Collider2D {
    size: size;
    offset: Vector2;
}

const CAR_COLLIDER: Collider2D = {
    size: {width: 2.49, height: 3.965},
    offset: {x: 0, y: 0}
};

// Offset collider theo obstacleId (khớp m_Offset trong prefab). Kích thước lấy từ OBSTACLE_MAP.
const OBSTACLE_COLLIDER_OFFSETS: Record<string, Vector2> = {
    oil: {x: 0, y: 0},
    fence: {x: 0, y: 0},
    cone: {x: 0, y: 0},
    tire: {x: 0, y: 0}
};

// Dung sai va chạm (mét). >0 sẽ CO nhỏ vùng overlap (chỉ tính hit khi xuyên sâu hơn dung sai);
// <0 sẽ NỚI rộng. Mặc định 0 vì collider server đã trùng khớp client. Đây là "núm chỉnh" để tinh
// chỉnh các ca chạm mép nếu cần — LƯU Ý: tăng dung sai có thể làm rớt các hit chạm mép thật của client.
const COLLISION_EDGE_TOLERANCE = 0.0;

// Kiểm tra overlap AABB rời rạc giữa hộp xe và hộp bẫy TẠI một vị trí (tâm collider đã cộng offset).
// Dùng đúng ngưỡng như Unity (overlap khi khoảng cách tâm < tổng nửa cạnh), có trừ dung sai để chuẩn
// hóa các ca chạm mép. Đây là phép kiểm rời rạc tại đúng các frame client đã ghi (mỗi sensor = 1 frame),
// KHÔNG nội suy đường tâm giữa 2 sample (tránh false-positive do "cắt góc" của swept-AABB).
function checkAABBOverlap(
    carCenter: Vector2,
    obsCenter: Vector2,
    obsSize: size,
    tolerance: number
): boolean {
    const halfW = (CAR_COLLIDER.size.width + obsSize.width) / 2 - tolerance;
    const halfH = (CAR_COLLIDER.size.height + obsSize.height) / 2 - tolerance;
    return (
        Math.abs(carCenter.x - obsCenter.x) < halfW &&
        Math.abs(carCenter.y - obsCenter.y) < halfH
    );
}

function getBaseSpeedAtTime(t: number): number {
    for (let i = 0; i < SPEED_LEVELS.length; i++) {
        const current = SPEED_LEVELS[i];
        const next = SPEED_LEVELS[i + 1];
        if (next && t >= current.activeTime && t < next.activeTime) {
            const progress = (t - current.activeTime) / (next.activeTime - current.activeTime);
            return current.speed + (next.speed - current.speed) * progress;
        } else if (!next && t >= current.activeTime) {
            return current.speed;
        }
    }
    return SPEED_LEVELS[0].speed;
}

function getBaseDistanceInRange(t1: number, t2: number): number {
    if (t2 <= t1) return 0;
    let totalDist = 0;
    const len = SPEED_LEVELS.length;
    for (let i = 0; i < len; i++) {
        const current = SPEED_LEVELS[i];
        const next = SPEED_LEVELS[i + 1];
        const segStart = current.activeTime;
        const segEnd = next ? next.activeTime : Infinity;

        const overlapStart = Math.max(t1, segStart);
        const overlapEnd = Math.min(t2, segEnd);

        if (overlapStart < overlapEnd) {
            const dt = overlapEnd - overlapStart;
            if (next) {
                // Đang tăng tốc tuyến tính: v(t) = v_start + a * (t - t_start)
                const a = (next.speed - current.speed) / (next.activeTime - current.activeTime);
                const v1 = current.speed + a * (overlapStart - segStart);
                const v2 = current.speed + a * (overlapEnd - segStart);
                totalDist += ((v1 + v2) / 2) * dt;
            } else {
                // Tốc độ không đổi ở level cuối
                totalDist += current.speed * dt;
            }
        }
    }
    return totalDist;
}

interface VerifiedHitTrap {
    absoluteDistanceY: number;
    stateConfig: CarState;
    obstacleId: string;
}

// --- SETUP EXPRESS SERVER ---
const activeSessions: Record<string, GameSession> = {};
const app = express();
const END_SESSION_JSON_LIMIT = '1mb';

function logTimestamp(): string {
    return `\x1b[90m[${new Date().toISOString()}]\x1b[0m`;
}

// --- API ENDPOINTS ---
app.post('/auth/login', (req: Request, res: Response) => {
    const token = "1an9aO8WiUfO2VanwQpC0Bx0jsNpkDCj1GOIeQPpGgWMn0WPylZ6pIqvVI4hDZTYaQsnPtyoTlWNAe9Bdq71/5pakSJAQskF6XYhTF/RzkKSxrB0y2YUIDBd09TKNgmk1XjOZs67PqUG4+tsGZpZCL6eRx+qvjOwbEK5W6NcijzR1qcrQn0Z40v9JNnE8FiSoAobFAWd/RsWIDkSBQ0g0BhxLiFhfV7RRJEjXDbz5jKtRwZbN8lUdvM4kfGfgz+YKXi/AarSDXaeFZxRtLto189ULSRSUKxJ28jMx96nqeC+Sb0KlyDyr2h2S9htnNFV/W7a6FvD7+NiQ2Rn2wchtAPC1uUo+fyaYYMSZwO5Xrxgi1I0iGNkyJSlKyH4wtXFrypJ7GJskjaJguhua6d3";
    const tokenURIEncoded = "1an9aO8WiUfO2VanwQpC0Bx0jsNpkDCj1GOIeQPpGgWMn0WPylZ6pIqvVI4hDZTYaQsnPtyoTlWNAe9Bdq71%2F5pakSJAQskF6XYhTF%2FRzkKSxrB0y2YUIDBd09TKNgmk1XjOZs67PqUG4%2BtsGZpZCL6eRx%2BqvjOwbEK5W6NcijzR1qcrQn0Z40v9JNnE8FiSoAobFAWd%2FRsWIDkSBQ0g0BhxLiFhfV7RRJEjXDbz5jKtRwZbN8lUdvM4kfGfgz%2BYKXi%2FAarSDXaeFZxRtLto189ULSRSUKxJ28jMx96nqeC+Sb0KlyDyr2h2S9htnNFV/W7a6FvD7+NiQ2Rn2wchtAPC1uUo+fyaYYMSZwO5Xrxgi1I0iGNkyJSlKyH4wtXFrypJ7GJskjaJguhua6d3";

    const dataResponse = {token, tokenURIEncoded};
    console.log(`${logTimestamp()} \x1b[32m[Game Login] [Login thành công]`);
    return res.json({success: true, data: dataResponse});
});

app.post('/play/rr/init', (req: Request, res: Response) => {
    console.log(`${logTimestamp()} \x1b[32m[Game Init] [Init data thành công]`);
    return res.json(initData);
});

app.post('/play/rr/start-session', (req: Request, res: Response) => {
    const sessionId = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

    const mapSeed = generateRandomSeed();

    activeSessions[sessionId] = {
        sessionId,
        mapSeed,
        startTime: Date.now(),
        isValidated: false
    };

    return res.json({success: true, data: {sessionId: sessionId, mapSeed: mapSeed}});
});

// --- LÕI XÁC THỰC TUYẾN TÍNH CHỐNG GIAN LẬN ---
app.post('/play/rr/end-session', express.json({limit: END_SESSION_JSON_LIMIT}), (req: Request, res: Response) => {
    const {
        sessionId,
        distance,
        totalPauseDuration,
        trapDataArray
    }: BatchValidationRequest = req.body;

    const start = performance.now();

    const session = activeSessions[sessionId];
    if (!session || session.isValidated) {
        return res.status(403).json({success: false, message: "Session không hợp lệ hoặc đã hết hạn!"});
    }

    const rawPlayTimeMs = Date.now() - session.startTime;

    if (totalPauseDuration < 0 || totalPauseDuration > rawPlayTimeMs) {
        delete activeSessions[sessionId];
        return res.status(400).json({
            success: false,
            message: "Thời gian tạm dừng không hợp lệ!"
        });
    }

    const actualRunningTimeMs = rawPlayTimeMs - totalPauseDuration;
    const totalPlayTimeSeconds = actualRunningTimeMs / 1000;

    const TIME_TOLERANCE = 2;
    const MAX_ALLOWED_TIME = GAME_TIME + TIME_TOLERANCE;

    if (totalPlayTimeSeconds <= 0 || totalPlayTimeSeconds > MAX_ALLOWED_TIME) {
        delete activeSessions[sessionId];
        return res.status(400).json({success: false, message: "Dữ liệu thời gian chơi không hợp lệ!"});
    }

    // =================================================================================
    // PARSE SEED TỪ SESSION (BASE64URL -> BUFFER 16 BYTES)
    // =================================================================================
    let seedBytes: Buffer;
    try {
        seedBytes = parseBase64UrlToBytes(session.mapSeed);
    } catch (err: any) {
        delete activeSessions[sessionId];
        return res.status(400).json({success: false, message: `Lỗi parse seed: ${err.message}`});
    }

    // 1. Tái dựng map
    const serverReconstructedSpawnList = generateSpawnListDeterministic(seedBytes);
    const maxTheoreticalIndex = Math.floor(calculateMaxPossibleDistance() / ROAD_PATH_HEIGHT);

    // =================================================================================
    // 1.5 ĐỐI CHIẾU CẤU TRÚC SNAPSHOT
    // =================================================================================
    if (!trapDataArray || trapDataArray.length === 0) {
        delete activeSessions[sessionId];
        return res.status(400).json({success: false, message: "Hành trình trống!"});
    }

    const lenTrapData = trapDataArray.length;
    let simulatedDistance = 0;
    let timeCursor = 0;
    const CAR_START_Y = -6.28;
    const CAR_HEIGHT = CarSize.height; // 3.965
    const CAR_HALF_HEIGHT = CAR_HEIGHT / 2; // 1.9825

    // QUAN TRỌNG: BoxCollider2D của xe (StartScene) có m_Offset = 0 => TÂM collider TRÙNG pivot
    // (transform.localPosition). Do đó carCenterY = carPivotY, KHÔNG cộng thêm nửa chiều cao.
    // (Bản cũ cộng +CAR_HALF_HEIGHT là sai, đẩy xe lên cao ~1.98m so với thực tế.)

    // Khoảng cách từ Start tới lúc snapshot ĐẦU TIÊN được ghi (client dùng lưới sensor 1m/sensor,
    // tâm sensor tại các mốc Y = n + 0.5 dọc toàn map — xem SnapShotSensorCreator: 32 sensor / segment 32m).
    // Lúc spawn: pivot xe = -6.28, tâm collider = pivot => mép TRÊN xe = -6.28 + 1.9825 = -4.2975.
    // Sensor đầu tiên xe CHƯA chạm khi spawn là sensor tâm -3.5 (đáy = -4.0). OnTriggerEnter2D kích hoạt
    // khi mép trên xe chạm đáy sensor => xe đi thêm: (-4.0) - (-4.2975) = 0.2975m.
    // => Tại snapshot i: carPivotY = CAR_START_Y + FIRST_SENSOR_DISTANCE + i = i - 5.9825 (khớp client).
    const FIRST_SENSOR_DISTANCE = -4.0 - (CAR_START_Y + CAR_HALF_HEIGHT); // = 0.2975

    // Hệ thống State-based Debuff
    let activeDebuff: { endTime: number; multiplier: number; stateId: string } | null = null;

    let totalTrapsInPath = 0;
    const hitTrapsSet = new Set<string>();
    let minX = Infinity;
    let maxX = -Infinity;

    // Theo dõi tọa độ X của snapshot liền trước để ràng buộc dịch ngang (chống teleport né bẫy).
    let prevX: number | null = null;

    // Cờ đánh dấu đã cạn quỹ thời gian mô phỏng vật lý. Khi bật, ta NGỪNG tiến mô phỏng
    // tốc độ/khoảng cách (đóng băng simulatedDistance để dùng cho kiểm tra chống speed-hack),
    // nhưng VẪN tiếp tục phát hiện va chạm hình học trên các snapshot còn lại — vì phát hiện
    // hit chỉ phụ thuộc vị trí đã ghi (targetDistance + X), không phụ thuộc quỹ thời gian.
    // Nhờ tách bạch này, các hit muộn có thật của client không bị bỏ sót chỉ vì sim tụt lại.
    let timeExhausted = false;

    const verifiedHits: { sensorIndex: number; time: number; distance: number; trapId: string; state: string }[] = [];

    for (let i = 0; i < lenTrapData; i++) {
        const clientSnapshot = trapDataArray[i];
        const targetIndex = clientSnapshot.i;

        // --- KIỂM TRA SPEED HACK ---
        // Nếu client vượt quá index lý thuyết tối đa (đã tính dư 2 segment dự phòng)
        if (targetIndex > maxTheoreticalIndex + 2) {
            delete activeSessions[sessionId];
            console.log(`${logTimestamp()} \x1b[31m[Anti-Cheat] [Speed Hack] Session: ${sessionId}, ClientIndex: ${targetIndex}, MaxTheoretical: ${maxTheoreticalIndex}\x1b[0m`);
            return res.status(400).json({success: false, message: "Phát hiện tốc độ di chuyển bất thường!"});
        }

        // 2.1 Giải mã tọa độ X từ giá trị chuẩn hóa (Normalize)
        const reconstructedX = clientSnapshot.x * CarLimitX;

        // 2.2 Kiểm tra giới hạn X
        if (Math.abs(reconstructedX) > (CarLimitX + CAR_X_TOLERANCE)) {
            delete activeSessions[sessionId];
            return res.status(400).json({success: false, message: "Tọa độ xe vượt quá giới hạn cho phép!"});
        }

        minX = Math.min(minX, reconstructedX);
        maxX = Math.max(maxX, reconstructedX);

        // 2.3 Mô phỏng thời gian TÁI HIỆN ĐÚNG UPDATE LOOP CỦA UNITY.
        //     Unity tích phân theo THỜI GIAN với bước cố định (Time.deltaTime ≈ 1/60s):
        //         transform.y += CurrentSpeed * multiplier * Time.deltaTime  (forward-Euler)
        //     Do đó server cũng phải tiến theo BƯỚC THỜI GIAN CỐ ĐỊNH = 1/60s và KHÔNG kẹp dt
        //     theo mốc sensor. (Kẹp dt về từng sensor cách nhau 1m sẽ tạo breakpoint lệch pha
        //     với frame Unity -> sai số forward-Euler tích lũy suốt 60s.)
        //     targetDistance là vị trí chuẩn của sensor hiện tại. Sau khi một trap làm đổi state,
        //     simulatedDistance sẽ được hiệu chỉnh về mốc này để state mới tiếp tục mô phỏng từ
        //     đúng vị trí sensor, thay vì mang theo phần overshoot của frame phát hiện va chạm.
        const targetDistance = FIRST_SENSOR_DISTANCE + i * SNAP_DISTANCE;

        while (simulatedDistance < targetDistance && timeCursor < totalPlayTimeSeconds) {
            // Hết hiệu lực debuff tại ranh giới thời gian (tương đương timer -= Time.deltaTime của Unity).
            if (activeDebuff && timeCursor >= activeDebuff.endTime) {
                console.log(`${logTimestamp()} \x1b[32m[Anti-Cheat] [Debuff Expired] State: ${activeDebuff.stateId}, Time: ${timeCursor.toFixed(2)}s, Dist: ${simulatedDistance.toFixed(2)}m\x1b[0m`);
                activeDebuff = null;
            }

            const currentBaseSpeed = getBaseSpeedAtTime(timeCursor);
            const currentMultiplier = activeDebuff ? activeDebuff.multiplier : 1.0;
            const currentActualSpeed = currentBaseSpeed * currentMultiplier;

            // Bước thời gian cố định = 1 frame Unity; frame cuối kẹp theo quỹ thời gian còn lại.
            const dt = Math.min(UNITY_FIXED_DELTA_TIME, totalPlayTimeSeconds - timeCursor);

            simulatedDistance += currentActualSpeed * dt;
            timeCursor += dt;
        }

        // Cạn quỹ thời gian trước khi xe kịp tới sensor i => mô phỏng vật lý không theo kịp.
        // KHÔNG dừng vòng lặp (tránh bỏ sót hit muộn có thật của client). Chỉ đóng băng mô phỏng
        // tốc độ (simulatedDistance giữ nguyên cho kiểm tra distance) và log MỘT lần, rồi tiếp tục
        // phát hiện va chạm hình học cho các snapshot còn lại.
        if (simulatedDistance < targetDistance - 1e-6) {
            if (!timeExhausted) {
                timeExhausted = true;
                console.log(`${logTimestamp()} \x1b[31m[Anti-Cheat] [Time Exhausted] Sensor: ${i}, SimDist: ${simulatedDistance.toFixed(2)}m < TargetDist: ${targetDistance.toFixed(2)}m @ ${timeCursor.toFixed(2)}s. Đóng băng mô phỏng, tiếp tục phát hiện va chạm.\x1b[0m`);
            }
        }

        // 2.3.1 CHỐNG TELEPORT NGANG BẰNG NGƯỠNG DỊCH NGANG TIÊU CHUẨN
        // Hai snapshot luôn cách nhau đúng 1 SNAP_DISTANCE theo trục dọc, nên ngưỡng dịch
        // ngang tối đa là HẰNG SỐ (MAX_LATERAL_DELTA_PER_SNAPSHOT) tính sẵn từ cấu hình.
        if (prevX !== null) {
            const deltaX = Math.abs(reconstructedX - prevX);

            if (deltaX > MAX_LATERAL_DELTA_PER_SNAPSHOT) {
                delete activeSessions[sessionId];
                console.log(`${logTimestamp()} \x1b[31m[Anti-Cheat] [Teleport] Session: ${sessionId}, Sensor: ${i}, deltaX: ${deltaX.toFixed(2)}m, maxDeltaX: ${MAX_LATERAL_DELTA_PER_SNAPSHOT.toFixed(2)}m\x1b[0m`);
                return res.status(400).json({
                    success: false,
                    message: "Phát hiện dịch chuyển ngang bất thường (teleport)!"
                });
            }
        }
        prevX = reconstructedX;

        // 2.4 Kiểm tra va chạm TẠI ĐÚNG VỊ TRÍ SENSOR.
        //     Client ghi snapshot X ngay khoảnh khắc mũi xe cắt qua sensor (SnapShotSensor.OnTriggerEnter2D),
        //     nên hình học va chạm phải lấy Y CHUẨN của sensor (targetDistance), không dùng phần overshoot
        //     của bước tích phân. simulatedDistance vẫn giữ phần overshoot cho đến khi có state event;
        //     tại state event, nó được hiệu chỉnh về đúng targetDistance trước khi mô phỏng tiếp.
        const currentCarPivotY = targetDistance + CAR_START_Y;
        // Collider xe có offset = 0 => tâm collider trùng pivot. Đây chính là Y client dùng cho
        // OnTriggerEnter2D (va chạm xảy ra khi mép trên xe = pivot + nửa cao chạm đáy bẫy).
        const currentCarCenterY = currentCarPivotY;

        const currentCarWorldPos: Vector2 = {
            x: reconstructedX,
            y: currentCarCenterY
        };

        // Log debug định kỳ mỗi 100 sensor để theo dõi hành trình
        if (i % 100 === 0) {
            console.log(`${logTimestamp()} \x1b[90m[Anti-Cheat] [DEBUG] Sensor ${i}: CarY=${currentCarPivotY.toFixed(2)}, Time=${timeCursor.toFixed(2)}s\x1b[0m`);
        }

        // 2.4.1 PHÁT HIỆN VA CHẠM RỜI RẠC TẠI ĐÚNG SNAPSHOT (khớp cơ chế client).
        //     Client kiểm tra overlap BoxCollider2D theo TỪNG FRAME. Mỗi snapshot ghi lại chính là
        //     một frame client (thời điểm mũi xe cắt qua sensor), nên server kiểm tra overlap rời rạc
        //     TẠI đúng các vị trí đã ghi — KHÔNG nội suy đường tâm giữa 2 snapshot (nội suy kiểu
        //     swept-AABB sinh false-positive do "cắt góc" bẫy ở đoạn thẳng ước lượng). Hộp xe cao
        //     ~4m phủ nhiều sensor nên bẫy thật vẫn được bắt ở ít nhất một snapshot.
        const carColliderCenter: Vector2 = {
            x: currentCarWorldPos.x + CAR_COLLIDER.offset.x,
            y: currentCarWorldPos.y + CAR_COLLIDER.offset.y
        };
        const centerIndex = mathfRoundToInt(carColliderCenter.y / ROAD_PATH_HEIGHT);

        // Gom các bẫy MỚI đang overlap tại snapshot này. Ưu tiên bẫy có worldY thấp nhất vì mép
        // trước (phía dưới) của xe chạm nó trước — đúng thứ tự vật lý client kích hoạt state.
        const overlappingTraps: {
            worldY: number;
            trapKey: string;
            obstacleId: string;
            obsConfig: obstacle;
            sIdx: number;
            localX: number;
            localY: number;
        }[] = [];

        for (let sIdx = centerIndex - 1; sIdx <= centerIndex + 1; sIdx++) {
            const segment = serverReconstructedSpawnList[sIdx];
            if (!segment || segment.obstacles.length === 0) continue;

            const roadConfig = ROAD_PATHS_MAP.get(segment.roadPathId);
            if (!roadConfig) continue;

            const roadWorldY = sIdx * ROAD_PATH_HEIGHT;

            for (let obsIdx = 0; obsIdx < segment.obstacles.length; obsIdx++) {
                const obsInfo = segment.obstacles[obsIdx];
                // Key va chạm dựa trên tọa độ cục bộ (theo pattern) thay cho positionIndex cũ.
                const trapKey = `${sIdx}_${obsIdx}`;
                const obsConfig = OBSTACLE_MAP.get(obsInfo.obstacleId);
                if (!obsConfig) continue;

                // Tâm collider bẫy = vị trí cục bộ pattern + offset collider (đọc từ prefab, hiện = 0).
                const obsOffset = OBSTACLE_COLLIDER_OFFSETS[obsInfo.obstacleId] ?? {x: 0, y: 0};
                const obstacleColliderCenter: Vector2 = {
                    x: obsInfo.x + obsOffset.x,
                    y: roadWorldY + obsInfo.y + obsOffset.y
                };

                if (checkAABBOverlap(carColliderCenter, obstacleColliderCenter, obsConfig.size, COLLISION_EDGE_TOLERANCE)) {
                    overlappingTraps.push({
                        worldY: obstacleColliderCenter.y,
                        trapKey,
                        obstacleId: obsInfo.obstacleId,
                        obsConfig,
                        sIdx,
                        // Vị trí CỤC BỘ của bẫy trong pattern (khớp obstacle.transform.localPosition phía client).
                        localX: obsInfo.x,
                        localY: obsInfo.y
                    });
                }
            }
        }

        // Xử lý theo thứ tự mép-trước-chạm-trước (worldY tăng dần).
        overlappingTraps.sort((a, b) => a.worldY - b.worldY);

        let stateWasUpdatedAtSensor = false;
        for (const hit of overlappingTraps) {
            const currentBaseSpeed = getBaseSpeedAtTime(timeCursor);
            if (hitTrapsSet.has(hit.trapKey)) {
                // Bẫy đã được ghi nhận ở snapshot trước đó (hộp xe cao ~4m phủ nhiều sensor).
                console.log(`${logTimestamp()} \x1b[90m[Anti-Cheat] [ALREADY HIT] Sensor: ${i}, Seg: ${hit.sIdx}, Trap: ${hit.obstacleId}, LocalPos: (${hit.localX.toFixed(2)}, ${hit.localY.toFixed(2)}), CarY: ${currentCarPivotY.toFixed(2)}\x1b[0m`);
                continue;
            }

            const targetStateId = hit.obsConfig.obstacleType === "Oil" ? "slipping" : "collided";
            const stateConfig = CarStates.find(s => s.stateId === targetStateId)!;

            if (activeDebuff && activeDebuff.stateId === targetStateId) {
                console.log(`${logTimestamp()} \x1b[33m[Anti-Cheat] [HIT-REFRESH] Sensor: ${i}, Seg: ${hit.sIdx}, Trap: ${hit.obstacleId}, LocalPos: (${hit.localX.toFixed(2)}, ${hit.localY.toFixed(2)}), State: ${targetStateId} refreshed\x1b[0m`);
            } else {
                console.log(`${logTimestamp()} \x1b[33m[Anti-Cheat] [HIT] Sensor: ${i}, Seg: ${hit.sIdx}, Trap: ${hit.obstacleId}, LocalPos: (${hit.localX.toFixed(2)}, ${hit.localY.toFixed(2)}), CarY: ${currentCarPivotY.toFixed(2)}, Time: ${timeCursor.toFixed(2)}s, Speed: ${(currentBaseSpeed * stateConfig.speedMultiplier).toFixed(2)}\x1b[0m`);
            }

            hitTrapsSet.add(hit.trapKey);
            verifiedHits.push({
                sensorIndex: i,
                time: timeCursor,
                distance: targetDistance,
                trapId: hit.obstacleId,
                state: targetStateId
            });

            // Ghi đè trạng thái (State-based) - Reset lại thời gian hiệu ứng.
            // Việc refresh cùng state cũng là một event state trên client (SwitchState
            // được gọi lại), nên cần snap vị trí tại sensor để tránh mang overshoot
            // của frame hiện tại sang lần mô phỏng tiếp theo.
            // Cập nhật debuff cho MỖI bẫy mới. Nếu trong cùng một snapshot xe chạm nhiều bẫy
            // (điển hình: các bẫy NGANG HÀNG ở khác làn, cùng worldY — ví dụ fence@(-3.5,y) và
            // cone@(3.5,y)), thì trên client mỗi bẫy kích hoạt một OnTriggerEnter2D riêng và đều
            // được ghi nhận. Vì vậy KHÔNG 'break': ghi nhận TẤT CẢ bẫy mới đang overlap tại snapshot
            // này. Xử lý theo worldY tăng dần nên debuff cuối cùng (bẫy xa nhất phía trước) là state
            // đang hiệu lực — khớp cách client kết thúc ở state của va chạm được xử lý sau cùng.
            activeDebuff = {
                endTime: timeCursor + stateConfig.activeDuration,
                multiplier: stateConfig.speedMultiplier,
                stateId: targetStateId
            };
            stateWasUpdatedAtSensor = true;
        }

        // Khi trap làm đổi state (hoặc refresh cùng state), Unity xử lý event tại sensor
        // đang kích hoạt. Đưa vị trí mô phỏng về đúng mốc chuẩn của sensor trước khi
        // vòng lặp tiếp tục, loại bỏ phần overshoot của frame forward-Euler vừa qua.
        // Chỉ hiệu chỉnh overshoot khi mô phỏng còn hiệu lực. Nếu đã cạn thời gian (timeExhausted),
        // simulatedDistance đang bị đóng băng THẤP hơn targetDistance; tuyệt đối không kéo nó lên
        // targetDistance (sẽ thổi phồng khoảng cách và làm sai lệch kiểm tra chống speed-hack).
        if (stateWasUpdatedAtSensor && !timeExhausted) {
            const overshootDistance = simulatedDistance - targetDistance;
            simulatedDistance = targetDistance;

            if (overshootDistance > 1e-6) {
                console.log(`${logTimestamp()} \x1b[36m[Anti-Cheat] [State Position Correction] Sensor: ${i}, State: ${activeDebuff?.stateId}, Overshoot: ${overshootDistance.toFixed(4)}m, CorrectedDistance: ${simulatedDistance.toFixed(4)}m\x1b[0m`);
            }
        }

        if (i % 50 === 0) {
            console.log(`${logTimestamp()} [Anti-Cheat] [DEBUG] Sensor ${i}: CarY=${currentCarWorldPos.y.toFixed(2)}, SimIndex=${centerIndex}, ClientIndex=${targetIndex}, Time=${timeCursor.toFixed(2)}s`);
        }
    }

    // 2.5 Di chuyển nốt quỹ thời gian còn lại sau snapshot cuối — DÙNG CÙNG BƯỚC THỜI GIAN 1/60s
    //     để đồng bộ tuyệt đối với Update loop của Unity (không nhảy sự kiện, tránh lệch tích phân).
    while (timeCursor < totalPlayTimeSeconds) {
        if (activeDebuff && timeCursor >= activeDebuff.endTime) activeDebuff = null;

        const currentBaseSpeed = getBaseSpeedAtTime(timeCursor);
        const currentMultiplier = activeDebuff ? activeDebuff.multiplier : 1.0;

        const dt = Math.min(UNITY_FIXED_DELTA_TIME, totalPlayTimeSeconds - timeCursor);
        simulatedDistance += currentBaseSpeed * currentMultiplier * dt;
        timeCursor += dt;
    }

    const allowedMaxDistance = simulatedDistance * 1.01;

    console.log(`${logTimestamp()} \x1b[36m[Anti-Cheat] [Distance Comparison] Session: ${sessionId}`);
    console.log(`  - Client Distance: ${distance.toFixed(2)}`);
    console.log(`  - Simulated Distance: ${simulatedDistance.toFixed(2)}`);
    console.log(`  - Allowed Max Distance: ${allowedMaxDistance.toFixed(2)}`);
    console.log(`  - Difference: ${(distance - simulatedDistance).toFixed(2)}`);
    console.log(`  - Result: ${distance <= allowedMaxDistance ? '\x1b[32mPASSED' : '\x1b[31mFAILED'}\x1b[0m`);

    // =================================================================================
    // 3. RÀNG BUỘC THỐNG KÊ (STATISTICAL CONSTRAINTS)
    // =================================================================================
    // Tính tổng số bẫy thực tế đã xuất hiện trên quãng đường người chơi đã đi
    const numSegmentsPassed = Math.floor(distance / ROAD_PATH_HEIGHT);
    for (let i = 0; i <= numSegmentsPassed; i++) {
        if (serverReconstructedSpawnList[i]) {
            totalTrapsInPath += serverReconstructedSpawnList[i].obstacles.length;
        }
    }

    const totalTrapsHit = hitTrapsSet.size;
    const trapDensity = distance > 0 ? totalTrapsInPath / distance : 0;

    // --- KIỂM TRA BIẾN THIÊN TỌA ĐỘ X (CHỐNG BOT ĐỨNG YÊN) ---
    const xVariation = maxX - minX;
    const MIN_X_VARIATION = 1.5; // Yêu cầu di chuyển ít nhất 1.5m theo chiều ngang trong cả phiên chơi
    if (xVariation < MIN_X_VARIATION) {
        delete activeSessions[sessionId];
        console.log(`${logTimestamp()} \x1b[31m[Anti-Cheat] [Bot Detected] Session: ${sessionId}, X-Variation: ${xVariation.toFixed(2)}m\x1b[0m`);
        return res.status(400).json({
            success: false,
            message: "Phát hiện hành vi gian lận (Bot đứng yên). Vui lòng di chuyển để tránh vật cản!"
        });
    }

    // --- 4. ĐỐI CHIẾU KẾT QUẢ CUỐI CÙNG ---
    if (distance > allowedMaxDistance /*|| timeCursor > totalPlayTimeSeconds + 0.5*/) {
        delete activeSessions[sessionId];
        console.log(`${logTimestamp()} \x1b[31m[Anti-Cheat] [Distance Validation Failed] Session: ${sessionId}`);
        console.log(`  - Client Distance: ${distance.toFixed(2)}`);
        console.log(`  - Simulated Distance: ${simulatedDistance.toFixed(2)}`);
        console.log(`  - Allowed Max: ${allowedMaxDistance.toFixed(2)}`);
        console.log(`  - Play Time: ${totalPlayTimeSeconds.toFixed(2)}s`);
        console.log(`  - Time Cursor: ${timeCursor.toFixed(2)}s\x1b[0m`);
        return res.status(400).json({success: false, message: "Xác thực khoảng cách thất bại!"});
    }

    delete activeSessions[sessionId];

    return res.json({
        success: true,
        data: {
            status: "verified",
            distance: distance.toFixed(5),
            bestDistance: (distance + 300).toFixed(5),
            isNewRecord: true,
            weeklyRank: 5,
            alltimeRank: 8,
        },
        message: "Xác thực phiên chơi thành công!"
    });
});

// Trả lỗi kích thước request theo JSON để client không nhận HTML/stack trace từ body-parser.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            message: `Request quá lớn. Giới hạn payload là ${END_SESSION_JSON_LIMIT}.`
        });
    }

    return next(err);
});

app.listen(3000, () => console.log("Anti-cheat system online with Position-Driven Car State simulation on port 3000" + "max distance=" + calculateMaxPossibleDistance()));