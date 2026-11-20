# Skyward Parkour – Starter Village → Rooftop City

Game leo trèo 3D (Three.js + TypeScript + Rapier) chạy trên trình duyệt desktop và điện thoại.
Phiên bản này: **Map 001 – Starter Village (0 → 140 m)** và **Map 002 – Rooftop City (140 → 320 m)** trong
**một thế giới liền mạch**: thành phố lơ lửng ngay phía trên làng, từ cổng trên đỉnh làng đi qua cây cầu ngắn sang
ga Rooftop City, không có màn tải. **Rơi từ thành phố là rơi thật xuống làng**: đáp xuống mái nhà, đảo đá, cột… hay bám
được mép nào thì dừng ở đó; không reset, không teleport, điểm (độ cao tối đa của lượt) được giữ nguyên và nối tiếp giữa hai map.
Dùng toàn bộ asset Meshy (2 nhân vật, 12 model Map 001, 32 model Map 002) và gói 73 ảnh PNG.

- **2 chế độ chơi**: Phiêu lưu (như trước) và Thử thách (luôn từ 0 m, chỉ lưu kỷ lục + thành tích). Xem "Chế độ chơi".
- **Map online, chơi offline**: Map 001 nằm sẵn trong app; Map 002 và các map sau tải từ Cloudflare R2 **một lần**, lưu trên máy, rồi chơi
  không cần mạng. Có mạng thì game báo map mới / bản cập nhật. Thêm hay sửa map **không cần cập nhật app** trên Google Play hay deploy lại Vercel.
  Xem "Map online".
- **Tên nhân vật + bảng xếp hạng online** (Cloudflare Worker + D1). Không có mạng vẫn chơi bình thường; kết quả được gửi khi có mạng.

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

## Chế độ chơi

| | Phiêu lưu | Thử thách |
|---|---|---|
| Bắt đầu | Từ 0 m, hoặc **tiếp tục từ map đã chinh phục** (ví dụ ga Rooftop City, 140 m) | **Luôn từ 0 m** |
| Rơi | Rơi tới đâu chơi tiếp từ đó | Rơi bao nhiêu leo lại bấy nhiêu |
| Checkpoint / dịch chuyển | Không có checkpoint; được bắt đầu từ map đã chinh phục; admin dùng được | **Không** checkpoint, **không** dịch chuyển, **không** admin |
| Lưu gì | Kỷ lục độ cao, thời gian, map cao nhất | **Chỉ kỷ lục** (độ cao, thời gian từ 0 m tới đích từng map) **và thành tích**. Không bao giờ lưu vị trí hay lượt đang chơi |
| Bảng xếp hạng | Bảng Phiêu lưu | Bảng Thử thách (tách riêng) |

Thành tích (Thử thách) sinh từ các map đang có trên máy: chạm từng mốc độ cao, chinh phục từng map, "Thần tốc" (Starter Village < 8 phút,
Rooftop City < 25 phút; map mới có thể tự đặt `challengeTime`), "Bước chân vững vàng" (qua Map 001 không rơi lần nào quá 10 m),
"Cú rơi để đời" (rơi một mạch > 50 m), "Không bỏ cuộc" (rơi tổng > 100 m trong một lượt rồi vẫn leo cao hơn).

## Map online – Download Once, Play Offline, Update When Online

- **Map 001** nằm sẵn trong app: chơi được ngay cả lần đầu mở khi chưa có mạng.
- **Map 002, 003…** là các *gói map* trên Cloudflare R2: `manifest.json` + `files/<sha256>`. Người chơi tải một lần (menu **Bản đồ**,
  hoặc thông báo "Có map mới" trên menu). Gói được lưu trên máy (IndexedDB), nên bật chế độ máy bay vẫn chơi Map 001 + 002 bình thường.
- **Khởi động không cần mạng**: game mở bằng dữ liệu đã có trên máy, không chờ server, không xác thực online.
  Có mạng thì game đọc manifest ở nền (tối đa 6 giây), so phiên bản và báo map mới / bản cập nhật; người chơi chọn **Tải ngay** hoặc **Để sau**.
- **Cập nhật từng phần**: mỗi tệp được đánh địa chỉ bằng mã SHA-256, nên sửa một map chỉ tải lại các tệp đã đổi (ví dụ sửa bố cục
  Map 002 = tải 27 KB thay vì 16 MB).
- **An toàn**: mọi tệp tải về đều được kiểm tra kích thước + SHA-256. Map chỉ chuyển sang bản mới khi toàn bộ bản mới đã nằm trên máy và
  đúng mã; tới lúc đó mới xoá các tệp cũ không còn dùng. Tải hỏng hoặc bị ngắt thì bản cũ vẫn chơi được (và lần sau tải tiếp phần còn thiếu).
  Map đang được chơi giữ nguyên tới khi mở lại game.
- **Cuối map an toàn**: mỗi map khai báo `exit.gate`, là chỗ map tiếp theo nối vào. Nếu map tiếp theo chưa có trên máy, chỗ đó bị chắn bằng
  một bức tường năng lượng có biển báo ("Chưa có trên máy · Menu → Bản đồ để tải" / "Sắp ra mắt" / "Kết nối mạng để kiểm tra map mới").
  Người chơi vẫn được công nhận đã chinh phục map. Tải map tiếp theo xong thì tường biến mất và lối đi mở ra. Các map phía dưới không bao giờ bị
  gỡ khỏi bộ nhớ, nên rơi luôn đáp xuống vật thật.
- Map cần tính năng mới của app (`minApp` lớn hơn bản app đang dùng) sẽ hiện "Cần cập nhật ứng dụng" thay vì tải về.
- Bản web (Vercel / TWA) có service worker: sau lần mở đầu tiên, app (code, Map 001, nhân vật) mở được khi không có mạng.
  Bản Capacitor thì tự có sẵn file trong APK.

### Chỉ commit lên GitHub (không chạy lệnh nào)

- Chưa có R2: commit + push là đủ. Vercel build và phát luôn các gói map trong `content/`.
  Bản cũ của Map 002 còn sót trong `public/` được build tự bỏ qua.
- Có R2: workflow `.github/workflows/publish-maps.yml` tự đưa map lên R2 mỗi lần push có đổi map
  (hoặc tab Actions → Publish maps to R2 → Run workflow). Cần khai báo trên GitHub (Settings → Secrets and variables → Actions):
  biến `CONTENT_URL` (địa chỉ r2.dev, có `/` cuối), tuỳ chọn `R2_BUCKET`; secret `CLOUDFLARE_API_TOKEN`
  (quyền Account · Workers R2 Storage · Edit) và `CLOUDFLARE_ACCOUNT_ID`. Workflow tự đặt CORS cho bucket.
  Chạy xong lần đầu thì mới đặt `VITE_CONTENT_URL` trên Vercel và Redeploy.

### Cài đặt Cloudflare R2 bằng dòng lệnh (một lần, nếu không dùng GitHub Actions)

```bash
npx wrangler login
npx wrangler r2 bucket create skyward-maps
npm run content:cors -- --bucket skyward-maps        # cho phép game (mọi domain, cả app Android) đọc map
```
Trong Cloudflare Dashboard → R2 → skyward-maps → Settings, bật **Public access**: dùng domain riêng (khuyên dùng) hoặc r2.dev để test.
Đặt URL đó vào biến môi trường **`VITE_CONTENT_URL`** (ví dụ `https://maps.ten-mien-cua-ban.com/`) trên Vercel và khi build Android,
rồi build/deploy **một lần cuối**. Từ đó trở đi map nằm trên R2, app không cần cập nhật khi thêm/sửa map.

Chưa cấu hình R2 thì bản build tự kèm thư mục `content/` (Vercel phát luôn các gói map). Cơ chế tải vẫn y hệt, chỉ khác là sửa map phải deploy lại.

### Thêm / sửa map và phát hành

```bash
node devtools/build-map002.mjs          # (hoặc map mới) -> packs/map002/maps/map002.json
npm run content:build                   # tự tăng version gói nào có thay đổi, tạo content-dist/
npm run content:publish -- --bucket skyward-maps --url https://maps.ten-mien-cua-ban.com/
```
`publish` chỉ tải lên các tệp mới. Tệp được tải lên trước, `manifest.json` lên **sau cùng**, nên người chơi không bao giờ thấy manifest trỏ tới
tệp chưa có. Tệp cache vĩnh viễn, manifest cache 60 giây.

## Bảng xếp hạng online (Cloudflare Worker + D1)

- Lần đầu mở game, người chơi **đặt tên** (2–16 ký tự, có dấu); có thể đổi sau ở menu. Không cần tài khoản, cũng không cần mạng để đặt tên.
  Mỗi máy tự tạo một id + mã bí mật; server chỉ lưu mã băm, nên không ai sửa được điểm của người khác. Tên được trùng nhau, trên bảng
  hiện kèm mã 4 ký tự (`Đức #E2C9`).
- Game gửi **kết quả tốt nhất**, không gửi từng lượt: độ cao cao nhất và thời gian từ 0 m tới đích từng map, cho cả Phiêu lưu và Thử thách.
  Chơi offline thì kết quả chờ trên máy và được gửi khi có mạng: lúc mở menu, khi về đích, khi máy có mạng lại, và 90 giây một lần lúc đang
  chơi nếu có kết quả mới. Mạng chậm hay mất không bao giờ làm game đứng.
- Bảng: Thử thách / Phiêu lưu × (Độ cao, thời gian từng map), có thứ hạng của bạn. Offline thì hiện bảng đã lưu lần trước, có ghi rõ thời điểm.
- Server từ chối độ cao không thể có (> `MAX_HEIGHT`), bỏ qua thời gian dưới `MIN_MAP_SECONDS`, giới hạn số lần ghi. Lưu ý: game chạy trên
  máy người chơi nên không thể chống gian lận tuyệt đối.

Cài đặt (thư mục `server/`):
```bash
cd server
npx wrangler d1 create skyward                    # dán database_id vào wrangler.toml
npx wrangler d1 execute skyward --remote --file=schema.sql
npx wrangler deploy                               # -> https://skyward-api.<subdomain>.workers.dev
```
Đặt **`VITE_API_URL`** = URL đó (Vercel + build Android), rồi build lại một lần. Không đặt thì menu báo "chưa kết nối máy chủ", game vẫn chạy bình thường.

## Chế độ admin (test map) – ẩn với người chơi

Không có nút nào hiện ra cho người chơi thường. **Chỉ có trên PC**: đang chơi thì **bấm phím M 5 lần liên tiếp** (mỗi lần cách nhau dưới 1 giây,
không xen phím khác). Trên điện thoại/máy tính bảng không mở được. Khi chạy `npm run dev`, admin mở luôn. Trên bản deploy, game hỏi
**mật khẩu admin**. Code chỉ lưu mã băm SHA-256 có muối của mật khẩu, không lưu chính mật khẩu. Có thể tick "Ghi nhớ trên thiết bị này".

- **Bay (F)**: bay xuyên mọi vật, WASD để đi, Space để lên, C để xuống, Shift hoặc nút Tốc độ để bay nhanh. Bấm **F** lần nữa để **thả nhân vật** chơi tiếp từ chỗ đó.
- **Đặt xuống (G)**: đặt nhân vật đứng lên mặt đầu tiên ngay bên dưới. **Thả lại (T)**: thả lại từ điểm thả gần nhất, tiện thử đi thử lại một cú nhảy.
- **Dịch chuyển tới…**: điểm xuất phát, lối vào từng khu, đầu mỗi đường tắt, gần đích của từng map (`waypoints` do generator sinh ra, đều là chỗ đứng được), cộng thêm các điểm đã lưu.
- **Lưu điểm (B)**, **Copy toạ độ** (để báo lỗi map), **Khoá admin** (xoá ghi nhớ trên thiết bị).
- Lượt chơi có dùng admin hiện nhãn **TEST**: không lưu kỷ lục cá nhân, không mở khoá map, không lưu thời gian. Bấm Chơi lại thì lượt mới tính bình thường.

Đổi mật khẩu: `node devtools/admin-hash.mjs "mật-khẩu-mới"` sẽ in ra `VITE_ADMIN_HASH=...`. Đặt giá trị này vào `.env.local` (máy bạn)
hoặc vào Vercel → Settings → Environment Variables, rồi build/deploy lại.

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
7. **Offline / online** (`node devtools/offline.cjs`, bản build + `vite preview` + `wrangler dev`): lần đầu đặt tên, cổng Map 001 đóng và chặn
   được → tải Map 002 (79 tệp) → cổng mở → **chế độ máy bay**: mở lại game, chơi Map 002, về đích 320 m (vẫn được tính), tường an toàn ở cổng
   Map 003 chặn được → kết quả chờ offline, có mạng lại thì tự gửi → sửa Map 002 trên server: chỉ tải 1 tệp (27 KB) → tải hỏng giữa chừng: bản cũ
   vẫn nguyên và chơi được offline.
8. **Hai chế độ** (`node devtools/modes.cjs`): Thử thách luôn từ 0 m, không admin/dịch chuyển, kỷ lục và thời gian tách khỏi Phiêu lưu, thành tích
   mở khoá, không lưu vị trí; Phiêu lưu vẫn tiếp tục từ Rooftop City.

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
  systems/     Score (kỷ lục theo chế độ), Achievements (Thử thách), Admin, Audio (âm thanh tổng hợp)
  content/     ContentManager + ContentStore: gói map tải về, lưu IndexedDB, kiểm tra SHA-256, cập nhật từng phần
  online/      Leaderboard: tên, gửi kết quả khi có mạng, bảng xếp hạng lưu offline
  ui/          Menu (2 chế độ), HUD, tạm dừng, cài đặt, màn hoàn thành, OnlineUI (tên, Bản đồ, xếp hạng, thành tích)
  world/Gates.ts  tường an toàn ở cuối map khi map tiếp theo chưa có trên máy
public/
  assets/characters/  hero-male.glb, hero-female.glb (đã tối ưu ~1,5 MB/nhân vật)
  assets/map001/      12 model Meshy (chuẩn hoá cao 1, LOD0 + LOD1) + collider .col.bin
  assets/sprites/     atlas 73 ảnh PNG Map 001
  maps/index.json     map nằm sẵn trong app (+ version của chúng)
  maps/map001.json    dữ liệu Map 001 (sinh bởi devtools)
packs/                gói map tải về (nguồn của R2)
  map001/pack.json    Map 001 (bundled: true, cập nhật được qua R2)
  map002/             pack.json + maps/map002.json + assets/map002/ (32 model Meshy, LOD + collider)
server/               Cloudflare Worker + D1 (bảng xếp hạng): wrangler.toml, schema.sql, src/index.ts
devtools/
  build-map001.mjs, build-map002.mjs, mapgen/   generator + validator + vẽ sơ đồ
  pipeline/                   tối ưu GLB Meshy (chuẩn hoá, WebP, meshopt, LOD, collider)
  build-sprites.mjs           đóng gói ảnh PNG thành atlas
  bot.cjs, bot2.cjs, moves.cjs, fuzz.cjs, fall.cjs, feel.cjs, touch.cjs, admin.cjs, city.cjs, smoke.cjs, mobile2.cjs   kiểm thử headless (Playwright)
  admin-hash.mjs           tạo mã băm cho mật khẩu admin mới
  content.mjs              build / publish gói map lên R2, cài CORS
  offline.cjs, modes.cjs   kiểm thử offline/online và hai chế độ
```

## Thêm Map 003 (không cần cập nhật app)

1. Tạo `devtools/build-map003.mjs` (copy cấu trúc Map 002): `origin` y = 320, `region`, đường đi bắt đầu đúng ở `exit.gate` của Map 002
   (mép tây đỉnh 320 m, `[-39.05, 318.74, -9.18]`), và `exit.gate` riêng cho Map 004. Xuất ra `packs/map003/maps/map003.json`.
2. Model mới đặt trong `packs/map003/assets/map003/` và khai báo trong map: `"prefabFiles": { "id": "assets/map003/id" }`
   (+ `"emissive"` nếu cần). Không phải sửa code game.
3. `packs/map003/pack.json`: `{ "id": "map003", "name": "...", "order": 3, "yMin": 320, "yMax": ..., "entry": "maps/map003.json",
   "minApp": 1, "requires": ["map002"] }`. Map cao hơn 340 m thì thêm tường biên cho phần trên.
4. `npm run content:build && npm run content:publish -- --bucket ...`. Người chơi đang online sẽ thấy "Có map mới: Map 003".
   Tính năng chơi mới (loại bệ/cơ chế mới) thì vẫn phải cập nhật app; khi đó đặt `minApp` = phiên bản app mới.

## Ghi chú hiệu năng

- Mức đồ hoạ tự chọn theo GPU: điện thoại = Thấp, card tích hợp = Trung bình, card rời = Cao. Độ phân giải bị giới hạn theo tổng số điểm ảnh; FPS thấp kéo dài thì tự hạ độ phân giải rồi hạ một mức chất lượng (nhớ cho lần sau) nếu người chơi chưa tự chọn.
- Rooftop City được tải nền ngay sau khi menu hiện (thấy được từ làng); toà nhà thủ tục gộp theo vật liệu (vài draw call cho cả thành phố).
- Prefab vẽ bằng InstancedMesh, LOD1 (~2k tam giác, màu theo đỉnh) cho vật ở xa; bệ thủ tục gộp theo vật liệu; toàn bộ ảnh 2D là một draw call.
- Cần đo FPS trên thiết bị thật (Android tầm trung mục tiêu 30 FPS, desktop 60 FPS).
