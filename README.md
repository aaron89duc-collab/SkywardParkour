# Skyward Parkour – Map 001: Starter Village

Game leo trèo 3D (Three.js + TypeScript + Rapier) chạy trên trình duyệt desktop và điện thoại.
Phiên bản này: **Game Core + Player Controller + Map 001 (140 m)**, dùng toàn bộ asset Meshy (2 nhân vật, 12 model GLB) và gói 73 ảnh PNG của Map 001.

## Chạy thử

Yêu cầu: Node.js 18+.

```bash
npm install
npm run dev          # mở http://localhost:5173 (điện thoại cùng mạng LAN: http://<IP-máy>:5173)
npm run build        # bản production vào thư mục dist/
npm run preview      # chạy thử bản build
```

### Triển khai Vercel

Có sẵn `vercel.json` (framework Vite, output `dist`). Cách nhanh nhất:

```bash
npx vercel           # lần đầu đăng nhập & tạo project
npx vercel --prod
```

Hoặc đẩy thư mục này lên GitHub rồi Import vào Vercel – không cần cấu hình thêm.

## Điều khiển

| PC | Điện thoại | Chức năng |
|---|---|---|
| W A S D / phím mũi tên | Cần điều khiển ảo (trái) | Di chuyển (Ctrl/Alt: đi bộ; đẩy cần nhẹ = đi chậm) |
| Space (giữ lâu = nhảy cao) | NHẢY | Nhảy (cao ~2,55 m) |
| Space khi đang treo | LEO | Leo lên mép |
| A / D khi đang treo | Cần trái/phải khi treo | Di chuyển ngang dọc theo mép |
| S + Space khi đang treo | Kéo lùi + NHẢY | Đạp tường bật ngược ra sau |
| E hoặc Shift | THẢ | Đang treo: buông tay · Đứng sát mép: tụt xuống bám mép |
| Chuột (nhấp để khoá chuột) | Vuốt nửa phải màn hình | Xoay camera |
| Cuộn chuột | – | Zoom camera |
| Esc / P | Nút II | Tạm dừng |

## Chuyển động nhân vật

- **Bắt mép khi rơi**: rơi ngang qua mép bệ/đảo với tốc độ < 17 m/s (rơi khoảng dưới 3,5 m) thì tự bám, kể cả mép ở bên cạnh hay phía sau. Rơi nhanh hơn thì không bám được. Không bám khi đang đẩy cần ra xa tường hoặc đang bay khỏi tường đó.
- **Nhảy hụt một chút → đu lên (mantle)**: chân thấp hơn mép 0,3–1,25 m khi lao vào tường thì tự kéo người lên.
- **Treo**: đung đưa theo quán tính khi bắt mép lúc rơi, hai tay đặt đúng mép (IK). Leo lên 2 pha (kéo người → bước lên).
- **Di chuyển ngang khi treo** (từng nhịp tay ~1 m, tự dừng khi mép hết).
- **Tụt xuống bám mép**: bấm THẢ/E khi đứng gần mép, hoặc đi chậm ra khỏi mép → nhân vật quay lại và hạ người xuống treo.
- **Đạp tường bật ra sau** khi đang treo.
- **Lộn nhào khi tiếp đất**: rơi 3–24 m mà vẫn đang chạy và phía trước còn chỗ → lộn một vòng rồi chạy tiếp; tự phanh nếu sắp lăn ra khỏi mép.
- **Vượt rào**: chạy nhanh vào chướng ngại cao 0,45–1,3 m và mỏng → vault qua; chướng ngại dày → đẩy vào một chút là đu lên.
- Nghiêng người khi rẽ lúc chạy, tiếp đất "dính" khi không giữ cần (đỡ trượt khỏi bệ nhỏ), không còn giật trạng thái rơi trên bề mặt gồ ghề.

## Điện thoại

- Bấm **BẮT ĐẦU LEO** là vào toàn màn hình và khoá xoay ngang (Android/Chrome). Có nút toàn màn hình ở góc HUD và trong menu tạm dừng.
- iPhone (Safari không hỗ trợ toàn màn hình cho web): **Chia sẻ → Thêm vào MH chính**, mở từ biểu tượng Skyward sẽ chạy toàn màn hình (có sẵn manifest + icon).
- Cầm dọc sẽ hiện nhắc xoay ngang (có nút chơi dọc).
- Độ phân giải tự giảm/tăng theo FPS để giữ ~30 FPS trên điện thoại; rung nhẹ khi bám mép/tiếp đất mạnh (Android).

## Map 001 – Starter Village (140 m, 5 khu)

| Khu | Độ cao | Nội dung |
|---|---|---|
| A – Village Spawn | 0–14 m | Làng trên đảo bay khổng lồ: chợ, nhà, cổng làng, tinh thể khởi đầu. Đường chính: thùng hàng → mái chợ → mái nhà H2 → ống khói → tháp canh |
| B – Village Parkour | 14–40 m | Giàn giáo xoắn quanh **phía sau cối xay gió** → Thử thách 1 "Xà ngang" (dầm hẹp) → đảo I1 |
| C – Upper Village | 40–75 m | Leo mái nhà H6, **cầu treo khuất sau nhà**, đảo chợ I2, cổng đá trên đảo hình nón, vòng ra sau cối xay gió thứ hai |
| D – Floating Islands | 75–112 m | Thử thách 2 "Đá bay" → **lối đi sau thác nước** → cụm đảo (1 đảo cụt có rương) → cầu treo → đảo thác nước 2 |
| E – Upper Exit | 112–140 m | Thử thách 3 "Tháp xoắn" (cột đá, cần bám mép) → đảo đỉnh → bậc thang lên bệ 140 m → **Cổng sang Map 002 – Rooftop City** |

- **Gợi ý môi trường**: cờ xanh Skyward + đèn lồng dọc đường chính.
- **3 đường tắt khó** (đánh dấu kín đáo bằng nấm đỏ): S1 mái nhà H4 → cột đá → I1 (bỏ qua giàn giáo cối xay + xà ngang); S2 khúc gỗ dưới bụng đảo → cột bám → tổ cối xay gió 2; S3 từ đảo I5 → cột bám thẳng lên giữa tháp xoắn.
- **Khu tìm đường**: sau cối xay gió 1, cầu khuất sau nhà H6, sau thác nước WF1, cụm đảo I5–I7 (có đảo cụt).
- Hiệu ứng: thác nước chảy (shader) đổ xuống ao trong làng, biển mây, mây trôi mờ (tự mờ khi camera lại gần), mặt trời + lens flare + tia nắng, bloom, bụi nắng, chim bay, tinh thể phát sáng, cột sáng cổng ra, bụi khi tiếp đất, cỏ hoa đung đưa.

### Kiểm chứng tự động

Map được sinh từ `devtools/build-map001.mjs` (bố cục viết tay, các đoạn nối được đặt có tham số) và được kiểm tra bằng:

1. **Validator** (`npm run map`): đồ thị nhảy theo đúng vật lý trong `config.ts` – xác nhận có đường từ spawn đến cổng ra, không có chỗ kẹt (soft-lock), không bệ nào thiếu khoảng trống trên đầu. Ảnh sơ đồ: `devtools/out/map001_plan.png`.
2. **Bot vật lý** (`npm run test:bot`, cần `npm i -D playwright && npx playwright install chromium` và `npm run dev` đang chạy): bot chạy/nhảy từng đoạn bằng controller + collider thật. Kết quả hiện tại: đường chính 131/131, S1 14/14, S2 16/16, S3 14/14.
3. **Test chuyển động** (`node devtools/moves.cjs`): bắt mép khi rơi, rơi nhanh không bám, di chuyển ngang, đạp tường, leo lên, tụt xuống bám mép (nút & đi chậm), lộn nhào, đu lên giữa không trung, vault, mantle.

## Cấu trúc

```
src/
  core/        Game (vòng lặp fixed-step 60 Hz), Physics (Rapier), Assets
  input/       Input hợp nhất (bàn phím/chuột/cảm ứng), TouchControls
  player/      Player (KCC + state machine), CharacterModel (animation, IK)
  camera/      ThirdPersonCamera
  world/       MapManager (map xếp chồng theo chiều cao), Prefabs (instancing + LOD + trimesh),
               Kit (bệ thủ tục), Sprites (atlas PNG), Terrain, Environment (trời/nắng), Clouds
  fx/          Thác nước, ao, tinh thể, cột sáng, hạt, chim
  systems/     Score (độ cao tối đa, kỷ lục localStorage), Audio (âm thanh tổng hợp)
  ui/          Menu, HUD, tạm dừng, cài đặt, màn hoàn thành
public/
  assets/characters/  hero-male.glb, hero-female.glb (đã tối ưu ~1,5 MB/nhân vật)
  assets/map001/      12 model Meshy (chuẩn hoá cao 1, LOD0 + LOD1) + collider .col.bin
  assets/sprites/     atlas 73 ảnh PNG Map 001
  maps/index.json     danh sách map theo chiều cao (thêm Map 002 ở đây)
  maps/map001.json    dữ liệu Map 001 (sinh bởi devtools)
devtools/
  build-map001.mjs, mapgen/   generator + validator + vẽ sơ đồ
  pipeline/                   tối ưu GLB Meshy (chuẩn hoá, WebP, meshopt, LOD, collider)
  build-sprites.mjs           đóng gói ảnh PNG thành atlas
  bot.cjs, smoke.cjs, tour.cjs, mobile.cjs   kiểm thử headless (Playwright)
```

## Thêm Map 002

1. Tạo `devtools/build-map002.mjs` (copy cấu trúc Map 001), đặt `origin` y ≈ 140, xuất `public/maps/map002.json`.
2. Thêm dòng vào `public/maps/index.json` với `yMin`/`yMax` của Map 002.
3. `MapManager.ensureAround()` tự tải map theo độ cao người chơi; Map 001 giữ nguyên.

## Ghi chú hiệu năng

- Mức đồ hoạ tự chọn: điện thoại = Thấp (không bloom/tia nắng, LOD gần), PC = Cao. Đổi trong Cài đặt.
- Prefab vẽ bằng InstancedMesh, LOD1 (~2k tam giác, màu theo đỉnh) cho vật ở xa; bệ thủ tục gộp theo vật liệu; toàn bộ ảnh 2D là một draw call.
- Cần đo FPS trên thiết bị thật (Android tầm trung mục tiêu 30 FPS, desktop 60 FPS).
