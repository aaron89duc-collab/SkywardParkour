# Skyward Parkour – Starter Village → Rooftop City

Game leo trèo 3D (Three.js + TypeScript + Rapier) chạy trên trình duyệt desktop và điện thoại.
Phiên bản này: **Map 001 – Starter Village (0 → 140 m)** và **Map 002 – Rooftop City (140 → 320 m)** trong
**một thế giới liền mạch**: thành phố lơ lửng ngay phía trên làng, từ cổng trên đỉnh làng đi qua cây cầu ngắn sang
ga Rooftop City, không có màn tải. **Rơi từ thành phố là rơi thật xuống làng**: đáp xuống mái nhà, đảo đá, cột… hay bám
được mép nào thì dừng ở đó; không reset, không teleport, điểm (độ cao tối đa của lượt) được giữ nguyên và nối tiếp giữa hai map.
Dùng toàn bộ asset Meshy (2 nhân vật, 12 model Map 001, 32 model Map 002) và gói 73 ảnh PNG.

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
| Space (giữ ≥ 0,18 s = nhảy cao nhất) | NHẢY | Nhảy (cao 1,5–2,5 m tuỳ thời gian giữ) |
| Space khi đang treo | LEO | Leo lên mép |
| A / D khi đang treo | Cần trái/phải khi treo | Di chuyển ngang dọc theo mép |
| S + Space khi đang treo | Kéo lùi + NHẢY | Đạp tường bật ngược ra sau |
| E hoặc Shift | THẢ | Đang treo: buông tay · Đứng sát mép: tụt xuống bám mép |
| Chuột (nhấp để khoá chuột) | Vuốt nửa phải màn hình | Xoay camera |
| Cuộn chuột | – | Zoom camera |
| Esc / P | Nút II | Tạm dừng |
| W (giữ) khi bám thang | Đẩy cần lên | Leo thang (S/kéo xuống: tụt; Space: bật ra sau; E/THẢ: buông) |

## Chuyển động nhân vật

Thông số điều khiển (dùng chung PC & điện thoại, mô phỏng bước cố định 60 Hz – cùng thao tác ra cùng quỹ đạo ở 30/60/144 FPS):

| Cơ chế | Giá trị |
|---|---|
| Coyote time (vừa rời mép vẫn nhảy được) | 100 ms |
| Jump buffer (bấm nhảy sớm trước khi chạm đất) | 120 ms |
| Nhảy theo thời gian giữ | giữ ≥ 180 ms: cao nhất 2,46 m · chạm nhanh: 1,5 m trở lên, tỉ lệ theo thời gian giữ thật (đo bằng timestamp của sự kiện, không phụ thuộc FPS) |
| Điều khiển trên không | ~35% so với mặt đất; **giữ quán tính**: thả cần hoặc đẩy cần nửa chừng không làm mất đà, kéo ngược cần mới phanh |
| Dừng khi thả cần | ~0,15 s / 0,43 m từ tốc độ chạy, không giật |
| Snap xuống nền | chỉ bật khi đang đi trên nền, tắt hẳn trong pha nhảy |
| Smart ledge grab | tia ngang ở ngực → tia từ trên xuống tìm mặt trên → kiểm tra độ cao, độ dốc, chỗ treo & chỗ đứng trống → hỗ trợ ±0,2 m sang ngang (theo hướng cần, khi đang lên/đỉnh quỹ đạo) và 0,2 m theo chiều cao ở đỉnh quỹ đạo; không bám tường cạnh chỗ sắp đáp; IK tay chỉ chỉnh hình ảnh sau khi vật lý đã xác nhận mép |

- **Bắt mép khi rơi**: rơi ngang qua mép bệ/đảo với tốc độ < 17 m/s (rơi khoảng dưới 3,5 m) thì tự bám, kể cả mép ở bên cạnh hay phía sau. Rơi nhanh hơn thì không bám được. Không bám khi đang đẩy cần ra xa tường hoặc đang bay khỏi tường đó.
- **Nhảy hụt một chút → đu lên (mantle)**: chân thấp hơn mép 0,3–1,25 m khi lao vào tường thì tự kéo người lên.
- **Treo**: đung đưa theo quán tính khi bắt mép lúc rơi, hai tay đặt đúng mép (IK). Leo lên 2 pha (kéo người → bước lên).
- **Di chuyển ngang khi treo** (từng nhịp tay ~1 m, tự dừng khi mép hết).
- **Tụt xuống bám mép**: bấm THẢ/E khi đứng gần mép, hoặc đi chậm ra khỏi mép → nhân vật quay lại và hạ người xuống treo.
- **Đạp tường bật ra sau** khi đang treo.
- **Lộn nhào khi tiếp đất**: rơi 3–24 m mà vẫn đang chạy và phía trước còn chỗ → lộn một vòng rồi chạy tiếp; tự phanh nếu sắp lăn ra khỏi mép.
- **Vượt rào**: chạy nhanh vào chướng ngại cao 0,45–1,3 m và mỏng → vault qua; chướng ngại dày → đẩy vào một chút là đu lên.
- Nghiêng người khi rẽ lúc chạy, tiếp đất "dính" khi không giữ cần (đỡ trượt khỏi bệ nhỏ), không còn giật trạng thái rơi trên bề mặt gồ ghề.

## Cơ chế mới ở Rooftop City

- **Thang thoát hiểm / thang bồn nước**: đi vào thang là bám; lên tới đỉnh tự trèo qua mép (kể cả tường chắn mái).
- **Bệ di chuyển**: pallet treo dưới **cần cẩu** (chạy ra đầu cần và kéo lên 9 m, chu kỳ ~20 s) và **bệ bay**; đứng trên bệ sẽ được chở theo, bám mép bệ cũng được, nhảy khỏi bệ thừa hưởng vận tốc của bệ.
- **Sky Jump Pad (đệm bật trên không)** – chỉ 3 vị trí: quảng trường ga (nhập môn), sau chân cần cẩu (đường tắt ẩn), đệm cuối lên đỉnh 320 m.
  Chạm đệm → đệm lún 0,1 s (vòng sáng, tiếng lò xo, hạt năng lượng) → bật lên. Mũi tên hologram chỉ hướng đích, vòng sáng mờ đánh dấu điểm đáp.
  Lực bật chỉ đưa ~74% quãng đường: phải giữ hướng và căn tiếp đất (điều khiển một phần, không đổi hướng tức thời). Hụt nhưng sát mép thì bám mép cứu; hụt hẳn thì rơi xuống mái thấp hơn, không reset.
  Camera: lùi & tăng FOV khi bật, ổn định ở đỉnh quỹ đạo, hơi nhìn xuống khi rơi, trở lại bình thường khi đáp.
- **Speed Pad + Speed Ring**: đệm tăng tốc 15 m/s trên đường băng mái nhà, nhảy qua vòng để bay tiếp qua hẻm 9 m.
- **Cảm giác độ cao**: sương mù theo độ cao (cảnh càng xa phía dưới càng mờ xanh), lớp mây giữa làng và thành phố, bóng đổ chiếu thẳng xuống điểm đáp khi đang trên không, FOV rộng dần + rung nhẹ khi rơi nhanh.

## Điện thoại

**Điều khiển cảm ứng** (Pointer Events + `setPointerCapture`, mỗi ngón một `pointerId`, `touch-action: none`):

- **Cần ảo nổi** ở nửa trái: vùng chết tròn 12%, nửa đầu hành trình là tốc độ đi bộ (căn chỉnh trên dầm hẹp), nửa sau tăng lên chạy, đủ tốc ở 85% bán kính. Vector chuẩn hoá (đi chéo không nhanh hơn), hướng theo yaw camera (không dùng pitch). Kéo quá vành thì đế cần đi theo ngón tay → đổi hướng phản hồi ngay.
- **Vuốt camera** ở nửa phải: ngón vuốt được giữ riêng, vuốt lướt qua nút NHẢY **không bao giờ** kích hoạt nút (nút chỉ nhận ngón đặt xuống trên nó).
- **NHẢY/THẢ**: ngón bấm được capture, trượt nhẹ ra ngoài nút khi đang giữ không làm cắt cú nhảy. Chuyển app/kéo thanh thông báo → mọi nút & cần tự nhả.
- **Camera 5 trạng thái**: Chạy (theo sau, xoay bằng vuốt) · Nhảy (theo độ cao mượt, chỉ theo ~45% độ nảy để đường chân trời ổn định, không tự xoay ngang) · Rơi (theo nhanh, lùi nhẹ để thấy mặt đất bên dưới) · Treo mép (nâng cao & lùi để thấy mép và chỗ leo lên) · Jump Pad (lùi + FOV rồi trở lại). Va chạm camera bằng sphere cast của Rapier.
  **Camera tự căn** (rất nhẹ, chỉ khi chạy thẳng trên mặt đất, không bao giờ khi đang bay) – bật mặc định trên điện thoại, tắt được trong **Cài đặt**.

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

## Map 002 – Rooftop City (140 → 320 m, 6 khu)

Thành phố trên một nền nổi (bán kính 72 m) cạnh làng, nối với đỉnh Map 001 bằng cầu trên mây có lan can và tường vô hình (không rơi ra ngoài thế giới).

| Khu | Độ cao | Nội dung |
|---|---|---|
| A – Ga Trên Mây | 140–157 | Quảng trường ga, đệm bật nhập môn, mái tiệm gạch, bồn nước W1 (thang) |
| B – Dãy Mái Nhà | 157–190 | Ban công, máy lạnh làm bậc, dây phơi, **Thử thách A: The Impossible Jump** |
| C – Công Trường Cần Cẩu | 190–225 | Thang lên mái B8, thùng gỗ, **Thử thách B: cần cẩu chở pallet**, khung thép đang xây, bệ bay qua phố |
| D – Hẻm Biển Quảng Cáo | 225–255 | Bục biển quảng cáo, **Thử thách D: Speed Gap** (đệm tăng tốc + vòng), hẻm có mái thấp + thang + bệ bay để leo lại |
| E – Tháp Kính | 255–290 | Cầu thang thoát hiểm zíc zắc 7 tầng, cột ban công ziczac trên mặt đông tháp kính |
| F – Vương Miện | 290–320 | Dầm thép qua trời sang tháp trung tâm, vòng xoắn 14 bệ quanh **tháp đồng hồ**, Sky Jump Pad cuối → **cổng portal sang Map 003** |

- **Thử thách A – The Impossible Jump**: mái B7 ngay trước mặt nhưng cao hơn 7,4 m. Ba lời giải: leo thang bồn nước W2 lấy độ cao rồi nhảy sang; đường ống gió (S1); hoặc hai ban công ẩn ở góc khuất mặt tây B7 (có chậu hoa và đèn lồng gợi ý).
- **Thử thách C – Hidden Rooftop Route (S2)**: đệm bật nấp sau chân cần cẩu ném người sang mái B9, vào khung thép rồi theo dầm khó sang B10 – bỏ qua cả lượt chờ cần cẩu lẫn bệ bay.
- **Đường tắt**: S1 ống gió dọc mặt đông B5–B7 (khó), S2 mái ẩn (khó), S3 cột bậu cửa sổ hẹp thẳng lên mặt tây tháp kính (rất khó, mỗi bậu là một lần bám + leo).
- Tới portal 320 m: bảng hoàn thành (Map 003 chưa mở). Menu có nút **Chơi tiếp từ Rooftop City** sau khi đã tới thành phố (không phải checkpoint: rơi vẫn rơi).

### Kiểm chứng tự động

Hai map được sinh từ `devtools/build-map001.mjs` và `devtools/build-map002.mjs` (bố cục viết tay, đoạn nối có tham số), kiểm tra bằng:

1. **Validator** (`node devtools/build-map00X.mjs`): đồ thị nhảy theo đúng vật lý trong `config.ts` (thêm liên kết thang/bệ di chuyển/đệm/vòng) – có đường tới đích, không soft-lock, đủ khoảng trống đầu, không chồng vật. Sơ đồ: `devtools/out/map00X_plan.png`.
2. **Bot vật lý** (cần `npm run dev` đang chạy và Playwright): `node devtools/bot.cjs` (Map 001) và `node devtools/bot2.cjs [route]` (Map 002, chạy cả bệ di chuyển theo thời gian mô phỏng, thang, đệm, vòng).
   Kết quả hiện tại – Map 001: chính 131/131, S1 14/14, S2 16/16, S3 14/14. Map 002: chính 120/120, S1 10/10, S2 14/14, S3 21/21, ban công ẩn 4/4, đường vòng hẻm 6/6.
3. **Test chuyển động** (`node devtools/moves.cjs`) và **fuzz kẹt-trong-nhà** (`node devtools/fuzz.cjs map001 700 <seed>`).
4. **Rơi từ thành phố** (`node devtools/fall.cjs <số lần> <seed>`): thả ngẫu nhiên khắp Rooftop City – 360 lần: luôn dừng lại đứng hoặc bám (≈60% rơi về làng), 0 lần kẹt, không ra khỏi thế giới, kỷ lục độ cao luôn được giữ.
5. **Cảm giác điều khiển** (`node devtools/feel.cjs`): quỹ đạo nhảy theo thời gian giữ ở 30/60/144 FPS (độ cao chênh ≤ 1,2 cm), quãng dừng, giữ quán tính, coyote, jump buffer.
6. **Cảm ứng thật** (`node devtools/touch.cjs`): sự kiện chạm đa điểm qua CDP – vùng chết/đường cong cần, đổi hướng sau khi kéo quá vành, vuốt camera lướt qua NHẢY, giữ NHẢY khi trượt ngón, 3 ngón cùng lúc.

## Cấu trúc

```
src/
  core/        Game (vòng lặp fixed-step 60 Hz), Physics (Rapier), Assets
  input/       Input hợp nhất (bàn phím/chuột/cảm ứng), TouchControls
  player/      Player (KCC + state machine), CharacterModel (animation, IK)
  camera/      ThirdPersonCamera
  world/       MapManager (nhiều map, thế giới liền mạch), Prefabs (instancing + LOD + trimesh),
               Kit (bệ + toà nhà thủ tục), CityTextures (mặt tiền, mái, biển quảng cáo), Movers (cần cẩu, bệ bay),
               Boosters (đệm bật, đệm tăng tốc, vòng, thang), HeightFog, Terrain, Environment, Clouds
  fx/          Thác nước, ao, tinh thể, cột sáng, hạt, chim
  systems/     Score (độ cao tối đa, kỷ lục localStorage), Audio (âm thanh tổng hợp)
  ui/          Menu, HUD, tạm dừng, cài đặt, màn hoàn thành
public/
  assets/characters/  hero-male.glb, hero-female.glb (đã tối ưu ~1,5 MB/nhân vật)
  assets/map001/      12 model Meshy (chuẩn hoá cao 1, LOD0 + LOD1) + collider .col.bin
  assets/map002/      32 model Meshy của Rooftop City (cần cẩu đã tách pallet, LOD + collider)
  assets/sprites/     atlas 73 ảnh PNG Map 001
  maps/index.json     danh sách map theo chiều cao
  maps/map001.json, map002.json   dữ liệu map (sinh bởi devtools)
devtools/
  build-map001.mjs, build-map002.mjs, mapgen/   generator + validator + vẽ sơ đồ
  pipeline/                   tối ưu GLB Meshy (chuẩn hoá, WebP, meshopt, LOD, collider)
  build-sprites.mjs           đóng gói ảnh PNG thành atlas
  bot.cjs, bot2.cjs, moves.cjs, fuzz.cjs, fall.cjs, feel.cjs, touch.cjs, city.cjs, smoke.cjs, mobile2.cjs   kiểm thử headless (Playwright)
```

## Thêm Map 003

1. Tạo `devtools/build-map003.mjs` (copy cấu trúc Map 002), `origin` y = 320, đặt `region` (tâm + bán kính) và xuất `public/maps/map003.json`.
2. Thêm dòng vào `public/maps/index.json`; Map 002 đã có `exit.next = "map003"` – khi map tồn tại, cổng portal sẽ dẫn thẳng sang (không hiện bảng hoàn thành).

## Ghi chú hiệu năng

- Mức đồ hoạ tự chọn theo GPU: điện thoại = Thấp, card tích hợp = Trung bình, card rời = Cao. Độ phân giải bị giới hạn theo tổng số điểm ảnh; FPS thấp kéo dài thì tự hạ độ phân giải rồi hạ một mức chất lượng (nhớ cho lần sau) nếu người chơi chưa tự chọn.
- Rooftop City được tải nền ngay sau khi menu hiện (thấy được từ làng); toà nhà thủ tục gộp theo vật liệu (vài draw call cho cả thành phố).
- Prefab vẽ bằng InstancedMesh, LOD1 (~2k tam giác, màu theo đỉnh) cho vật ở xa; bệ thủ tục gộp theo vật liệu; toàn bộ ảnh 2D là một draw call.
- Cần đo FPS trên thiết bị thật (Android tầm trung mục tiêu 30 FPS, desktop 60 FPS).
