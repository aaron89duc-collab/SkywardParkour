// Game languages: English (default) and Vietnamese. The choice is kept on the device (Settings → Language).
// UI text lives in STR below; map content (zone names, hints, signs, pack summaries) carries its own translations
// as optional sibling fields, e.g. zone `name` + `name_en` (older apps simply read `name`).

export type Lang = 'en' | 'vi';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'vi', label: 'Tiếng Việt' },
];

const KEY = 'skyward.lang';
const load = (): Lang => {
  try { const v = localStorage.getItem(KEY); if (v === 'en' || v === 'vi') return v; } catch { /* private mode */ }
  return 'en';
};
let cur: Lang = load();
const subs = new Set<() => void>();

export const lang = () => cur;
/** locale for dates / numbers */
export const locale = () => (cur === 'vi' ? 'vi-VN' : 'en-US');
export function setLang(l: Lang) {
  if (l === cur) return;
  cur = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  applyDocLang();
  for (const f of [...subs]) { try { f(); } catch (e) { console.warn(e); } }
}
/** call f whenever the language changes (returns an unsubscribe) */
export function onLang(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function applyDocLang() { if (typeof document !== 'undefined') document.documentElement.lang = cur; }

/** a localized content field: o[`${f}_${lang}`] ?? o[f] (map / pack data keep the original text in `f`) */
export function loc<T extends object>(o: T | null | undefined, f: string): string | undefined {
  if (!o) return undefined;
  const r = o as Record<string, unknown>;
  const v = r[`${f}_${cur}`] ?? r[f];
  return typeof v === 'string' ? v : undefined;
}

type Entry = { en: string; vi: string };
const STR = {
  // loading / errors
  'load.village': { en: 'Loading Starter Village…', vi: 'Đang tải Starter Village…' },
  'load.build': { en: 'Building {name}…', vi: 'Đang dựng {name}…' },
  'load.map': { en: 'the map', vi: 'bản đồ' },
  'load.character': { en: 'Calling your character…', vi: 'Đang gọi nhân vật…' },
  'load.error': { en: 'Could not load the game: {msg}. Please reload the page.', vi: 'Không thể tải game: {msg}. Hãy tải lại trang.' },
  // rotate / sync
  'rotate.t1': { en: 'Turn your phone sideways', vi: 'Xoay ngang điện thoại' },
  'rotate.t2': { en: 'Skyward Parkour plays best in landscape', vi: 'Skyward Parkour chơi tốt nhất ở màn hình ngang' },
  'rotate.keep': { en: 'Play in portrait anyway', vi: 'Vẫn chơi màn hình dọc' },
  'sync.nextN': { en: 'the next {n} maps', vi: '{n} map tiếp theo' },
  'sync.next': { en: 'the next map', vi: 'map tiếp theo' },
  'sync.offline': { en: 'No internet – {what} is not downloaded yet', vi: 'Không có mạng – chưa tải được {what}' },
  'sync.offline2': { en: 'Turn on the internet and the game downloads it by itself', vi: 'Bật mạng internet, game sẽ tự tải về' },
  // menu
  'menu.sub': { en: 'Climb without limits · falling never kills', vi: 'Leo cao không giới hạn · rơi không chết' },
  'menu.rename': { en: 'Rename', vi: 'Đổi tên' },
  'menu.male': { en: 'Male character', vi: 'Nhân vật nam' },
  'menu.female': { en: 'Female character', vi: 'Nhân vật nữ' },
  'menu.adventure': { en: 'ADVENTURE', vi: 'PHIÊU LƯU' },
  'menu.adventureSub': { en: 'Free play · continue from maps you conquered', vi: 'Chơi tự do · tiếp tục từ map đã chinh phục' },
  'menu.challenge': { en: 'CHALLENGE', vi: 'THỬ THÁCH' },
  'menu.challengeSub': { en: 'Always from 0 m · every fall must be climbed again', vi: 'Luôn từ 0 m · rơi bao nhiêu leo lại bấy nhiêu' },
  'menu.continue': { en: 'Continue the adventure from {name} · {y} m', vi: 'Phiêu lưu tiếp từ {name} · {y} m' },
  'menu.ios': { en: 'iPhone: tap <b>Share</b> → <b>Add to Home Screen</b> to play full screen', vi: 'iPhone: bấm <b>Chia sẻ</b> → <b>Thêm vào MH chính</b> để chơi toàn màn hình' },
  'menu.maps': { en: 'Maps', vi: 'Bản đồ' },
  'menu.leaderboard': { en: 'Leaderboard', vi: 'Bảng xếp hạng' },
  'menu.achievements': { en: 'Achievements', vi: 'Thành tích' },
  'menu.settings': { en: 'Settings', vi: 'Cài đặt' },
  'menu.bestAdventure': { en: 'Adventure record', vi: 'Kỷ lục Phiêu lưu' },
  'menu.bestChallenge': { en: 'Challenge record', vi: 'Kỷ lục Thử thách' },
  'menu.highestMap': { en: 'Highest map conquered', vi: 'Map cao nhất đã chinh phục' },
  'menu.bestTime': { en: 'Best time', vi: 'Thời gian tốt nhất' },
  'menu.bestTo': { en: 'Best time to the top of {name}', vi: 'Tốt nhất tới đỉnh {name}' },
  'menu.ctrlTouch': { en: 'Left stick: move · Swipe right side: turn the camera · JUMP / CLIMB', vi: 'Cần điều khiển trái: di chuyển · Vuốt phải: xoay camera · NHẢY / LEO' },
  'menu.ctrlKeys': {
    en: '<kbd>W A S D</kbd> move · <kbd>Space</kbd> jump (hold to jump higher) / climb up · <kbd>E</kbd>/<kbd>Shift</kbd> let go of a ledge, climb down onto a ledge · Mouse: camera · Wheel: zoom · <kbd>Esc</kbd> pause',
    vi: '<kbd>W A S D</kbd> di chuyển · <kbd>Space</kbd> nhảy (giữ lâu nhảy cao) / leo lên · <kbd>E</kbd>/<kbd>Shift</kbd> buông mép, trèo xuống mép · Chuột: xoay camera · Cuộn: zoom · <kbd>Esc</kbd> tạm dừng',
  },
  'menu.rules': { en: 'Falling never kills – wherever you land, you keep playing. No checkpoints.', vi: 'Rơi không chết – rơi xuống đâu, chơi tiếp ở đó. Không có checkpoint.' },
  // HUD
  'hud.challenge': { en: 'CHALLENGE', vi: 'THỬ THÁCH' },
  'hud.pause': { en: 'Pause', vi: 'Tạm dừng' },
  'hud.fullscreen': { en: 'Full screen', vi: 'Toàn màn hình' },
  'hud.runBest': { en: 'Run best', vi: 'Kỷ lục lượt' },
  'hud.personalBest': { en: 'Personal best', vi: 'Kỷ lục cá nhân' },
  'hud.time': { en: 'Time', vi: 'Thời gian' },
  'hud.zone': { en: 'Zone {id} – {name}', vi: 'Khu {id} – {name}' },
  'hud.clickCam': { en: 'Click the screen to control the camera', vi: 'Nhấp chuột vào màn hình để điều khiển camera' },
  // pause
  'pause.title': { en: 'Paused', vi: 'Tạm dừng' },
  'pause.resume': { en: 'Resume', vi: 'Tiếp tục' },
  'pause.charToF': { en: 'Switch character: Male → Female', vi: 'Đổi nhân vật: Nam → Nữ' },
  'pause.charToM': { en: 'Switch character: Female → Male', vi: 'Đổi nhân vật: Nữ → Nam' },
  'pause.exitFs': { en: 'Exit full screen', vi: 'Thoát toàn màn hình' },
  'pause.restart': { en: 'Start over from the bottom', vi: 'Chơi lại từ đầu' },
  'pause.confirm': { en: 'Tap again to confirm', vi: 'Bấm lần nữa để xác nhận' },
  'pause.menu': { en: 'Main menu', vi: 'Về menu chính' },
  'pause.note': { en: 'Switching character keeps your position and score.', vi: 'Đổi nhân vật giữ nguyên vị trí và điểm hiện tại.' },
  // settings
  'set.title': { en: 'Settings', vi: 'Cài đặt' },
  'set.language': { en: 'Language', vi: 'Ngôn ngữ' },
  'set.volume': { en: 'Volume', vi: 'Âm lượng' },
  'set.graphics': { en: 'Graphics', vi: 'Đồ họa' },
  'set.low': { en: 'Low', vi: 'Thấp' },
  'set.medium': { en: 'Medium', vi: 'Vừa' },
  'set.high': { en: 'High', vi: 'Cao' },
  'set.sens': { en: 'Camera sensitivity', vi: 'Độ nhạy camera' },
  'set.autocam': { en: 'Camera follows when running straight', vi: 'Camera tự căn khi chạy thẳng' },
  'set.fps': { en: 'Show FPS', vi: 'Hiện FPS' },
  'set.signsNote': { en: 'Signs in the world switch language the next time a map loads.', vi: 'Biển chữ trong thế giới đổi ngôn ngữ ở lần tải map sau.' },
  'common.done': { en: 'Done', vi: 'Xong' },
  'common.cancel': { en: 'Cancel', vi: 'Huỷ' },
  'common.save': { en: 'Save', vi: 'Lưu' },
  'common.close': { en: 'Close', vi: 'Đóng' },
  // Android app download (website only)
  'apk.pill': { en: 'Get the Android app', vi: 'Tải app Android' },
  'apk.title': { en: 'Android app', vi: 'App Android' },
  'apk.lead': { en: 'Skyward Parkour as an app: full screen without browser bars, Map 001 plays offline, the other maps download just like here.', vi: 'Skyward Parkour dạng ứng dụng: toàn màn hình, không có thanh trình duyệt, Map 001 chơi được khi không có mạng, các map khác tự tải về như trên web.' },
  'apk.steps': { en: '<b>1.</b> Tap <b>Download APK</b>. If the browser warns about the file, tap <b>Download anyway</b>.<br><b>2.</b> Open the downloaded file.<br><b>3.</b> If asked, allow <b>Install unknown apps</b> for your browser, then tap <b>Install</b> (if Play Protect warns: <b>Install anyway</b>).', vi: '<b>1.</b> Bấm <b>Tải APK</b>. Nếu trình duyệt cảnh báo tệp, chọn <b>Vẫn tải xuống</b>.<br><b>2.</b> Mở tệp vừa tải.<br><b>3.</b> Nếu được hỏi, cho phép <b>Cài ứng dụng không rõ nguồn gốc</b> cho trình duyệt, rồi bấm <b>Cài đặt</b> (nếu Play Protect cảnh báo: <b>Vẫn cài đặt</b>).' },
  'apk.desktop': { en: 'For Android phones and tablets: open this page on the phone, or download here and copy the file to it.', vi: 'Dành cho điện thoại / máy tính bảng Android: mở trang này trên điện thoại, hoặc tải ở đây rồi chép tệp sang máy.' },
  'apk.note': { en: 'Progress in the browser and in the app is saved separately.', vi: 'Tiến độ trên trình duyệt và trong app được lưu riêng.' },
  'apk.download': { en: 'Download APK', vi: 'Tải APK' },
  // finish
  'fin.thisRun': { en: 'Climbing time this run', vi: 'Thời gian leo lượt này' },
  'fin.best': { en: 'Best: {t}', vi: 'Tốt nhất: {t}' },
  'fin.explore': { en: 'Keep exploring', vi: 'Tiếp tục khám phá' },
  'fin.again': { en: 'Climb again from the bottom', vi: 'Leo lại từ đầu' },
  'fin.conquer': { en: '{name} conquered!', vi: 'Chinh phục {name}!' },
  'fin.through': { en: '{t} · Through the gate to {name}', vi: '{t} · Đi qua cổng sang {name}' },
  'fin.hint': { en: 'Try to find shortcuts to reach the top faster!', vi: 'Thử tìm đường tắt để về đích nhanh hơn!' },
  // gates / next map
  'gate.needsApp': { en: 'A newer version of the game is needed to open this way', vi: 'Cần bản game mới để mở đường này' },
  'gate.opening': { en: 'Opening the way…', vi: 'Đang mở đường…' },
  'gate.offline': { en: 'Turn on the internet to open this way', vi: 'Bật mạng internet để mở đường này' },
  'gate.offlineCheck': { en: 'Turn on the internet to check for new maps', vi: 'Bật mạng internet để kiểm tra map mới' },
  'gate.soonOpen': { en: 'Opening soon…', vi: 'Sắp mở…' },
  'gate.soon': { en: 'Coming soon', vi: 'Sắp ra mắt' },
  'gate.to': { en: 'Gate to <b>{name}</b>', vi: 'Cổng sang <b>{name}</b>' },
  'gate.opened': { en: 'Gate open!', vi: 'Cổng đã mở!' },
  'gate.openedSub': { en: 'The way up to {name} is ready', vi: 'Lối lên {name} đã sẵn sàng' },
  // in-game toasts
  'toast.test': { en: 'TEST run', vi: 'Lượt TEST' },
  'toast.testSub': { en: 'Admin mode was used: this run sets no records', vi: 'Đã dùng chế độ admin: lượt này không lưu kỷ lục' },
  'toast.lowerQ': { en: 'Graphics quality lowered', vi: 'Đã giảm chất lượng đồ hoạ' },
  'toast.lowerQSub': { en: 'So the game runs smoother — change it back in Settings', vi: 'Để game chạy mượt hơn — đổi lại trong Cài đặt' },
  'toast.newAch': { en: 'New achievement!', vi: 'Thành tích mới!' },
  'toast.fellTo': { en: 'Fell down to {name}', vi: 'Rơi xuống {name}' },
  'toast.fellToSub': { en: 'Your run best stays: {m} m — climb back up!', vi: 'Kỷ lục lượt này vẫn giữ: {m} m — leo lại thôi!' },
  'toast.record': { en: 'New record!', vi: 'Kỷ lục mới!' },
  'toast.recordCh': { en: 'You beat your old Challenge record', vi: 'Vượt kỷ lục Thử thách cũ' },
  'toast.recordPb': { en: 'You beat your old personal best', vi: 'Vượt kỷ lục cá nhân cũ' },
  'toast.milestone': { en: '{m} m!', vi: 'Mốc {m} m!' },
  'toast.summit': { en: 'Top of {name}', vi: 'Đỉnh {name}' },
  'toast.keepClimbing': { en: 'Keep climbing', vi: 'Tiếp tục leo lên' },
  'toast.zone': { en: 'Zone {id}', vi: 'Khu {id}' },
  'toast.slipped': { en: 'Stepped off an edge?', vi: 'Lỡ bước khỏi mép?' },
  'toast.slippedTouch': { en: 'Right after you slip, pull the stick back at once to catch the ledge', vi: 'Vừa hụt chân thì kéo cần ngược lại ngay để bám lại mép' },
  'toast.slippedKeys': { en: 'Right after you slip, press the opposite direction at once to catch the ledge', vi: 'Vừa hụt chân thì bấm phím ngược hướng ngay để bám lại mép' },
  'toast.backToVillage': { en: 'Back to the village', vi: 'Đã đưa về làng' },
  'toast.outOfWorld': { en: 'You fell out of the world', vi: 'Bạn rơi ra ngoài thế giới' },
  'toast.unstuck': { en: 'Freed from a tight spot', vi: 'Đã thoát chỗ kẹt' },
  'toast.unstuckSub': { en: 'Your character was moved out of the structure', vi: 'Nhân vật được đưa ra ngoài công trình' },
  'toast.checkpoint': { en: 'Respawn point', vi: 'Điểm hồi sinh' },
  'toast.checkpointSub': { en: 'Falling off the map brings you back here', vi: 'Rơi khỏi bản đồ sẽ quay lại đây' },
  'toast.gem': { en: 'Gem collected', vi: 'Nhặt được ngọc' },
  'toast.gemSub': { en: '{n} in {name}', vi: '{n} viên ở {name}' },
  'toast.thisMap': { en: 'this map', vi: 'map này' },
  'toast.ladder': { en: 'On a ladder', vi: 'Đang bám thang' },
  'toast.ladderTouch': { en: 'Push the stick up/down: climb · JUMP: leap off', vi: 'Đẩy cần lên/xuống: leo · NHẢY: bật ra' },
  'toast.ladderKeys': { en: 'W/S: climb up/down · Space: leap off', vi: 'W/S: leo lên/xuống · Space: bật ra' },
  'toast.ledge': { en: 'Hanging on a ledge', vi: 'Đang bám mép' },
  'toast.ledgeTouch': { en: 'JUMP: climb up · Stick left/right: shimmy · Pull back + JUMP: wall jump · Hold back: let go', vi: 'NHẢY: leo lên · Cần trái/phải: đi dọc mép · Kéo lùi + NHẢY: bật tường · Giữ kéo lùi: buông' },
  'toast.ledgeKeys': { en: 'Space: climb up · A/D: shimmy · S + Space: wall jump · Hold S: let go', vi: 'Space: leo lên · A/D: đi dọc mép · S + Space: bật tường · Giữ S: buông' },
  'toast.mapInfo': { en: 'Map {no} · {y0}–{y1} m', vi: 'Map {no} · {y0}–{y1} m' },
  'toast.ime': { en: 'Vietnamese typing (Unikey / EVKey) is on', vi: 'Bộ gõ tiếng Việt (Unikey / EVKey) đang bật' },
  'toast.imeSub': { en: 'It can swallow W A S D – switch it to English (E) while playing, or use the arrow keys', vi: 'Bộ gõ có thể "nuốt" phím W A S D – chuyển sang chế độ E (tiếng Anh) khi chơi, hoặc dùng phím mũi tên' },
  'toast.bloomOff': { en: 'Glow effect turned off', vi: 'Đã tắt hiệu ứng phát sáng' },
  'toast.bloomOffSub': { en: 'Your graphics card showed a black screen with it – the rest of High quality stays on', vi: 'Card đồ hoạ của máy bị màn hình đen với hiệu ứng này – các phần khác của chế độ Cao vẫn giữ' },
  // touch buttons
  'touch.drop': { en: 'DROP', vi: 'XUỐNG' },
  'touch.dropAria': { en: 'Drop', vi: 'Xuống' },
  'touch.jump': { en: 'JUMP', vi: 'NHẢY' },
  'touch.jumpAria': { en: 'Jump', vi: 'Nhảy' },
  'touch.up': { en: 'UP', vi: 'LÊN' },
  'touch.climb': { en: 'CLIMB', vi: 'LEO' },
  // achievements
  'ach.height': { en: 'Reach {h} m', vi: 'Chạm {h} m' },
  'ach.heightDesc': { en: 'Climb to {h} m in one Challenge run', vi: 'Leo tới {h} m trong một lượt Thử thách' },
  'ach.top': { en: 'Conquer {name}', vi: 'Chinh phục {name}' },
  'ach.topDesc': { en: 'Reach the exit gate of {name} in Challenge mode', vi: 'Tới cổng đích {name} ở chế độ Thử thách' },
  'ach.fast': { en: 'Speed climber – {name}', vi: 'Thần tốc – {name}' },
  'ach.fastDesc': { en: 'From 0 m to the top of {name} in under {min} minutes', vi: 'Từ 0 m tới đích {name} dưới {min} phút' },
  'ach.steady': { en: 'Steady feet', vi: 'Bước chân vững vàng' },
  'ach.steadyDesc': { en: 'Conquer {name} without a single fall of more than 10 m', vi: 'Chinh phục {name} mà không rơi lần nào quá 10 m' },
  'ach.fall50': { en: 'The fall of a lifetime', vi: 'Cú rơi để đời' },
  'ach.fall50Desc': { en: 'Fall more than 50 m in one go (and keep playing)', vi: 'Rơi một mạch hơn 50 m (và vẫn chơi tiếp)' },
  'ach.comeback': { en: 'Never give up', vi: 'Không bỏ cuộc' },
  'ach.comebackDesc': { en: 'In one run: fall more than 100 m in total, then climb higher than before', vi: 'Trong một lượt: rơi tổng cộng hơn 100 m rồi vẫn leo cao hơn trước đó' },
  // online: name, maps, achievements, leaderboard
  'name.player': { en: 'Player {n}', vi: 'Người chơi {n}' },
  'name.rename': { en: 'Rename', vi: 'Đổi tên' },
  'name.set': { en: 'Name your character', vi: 'Đặt tên nhân vật' },
  'name.rules': { en: '2–16 characters: letters (accents allowed), digits, spaces, _ . -<br>Your name is shown on the online leaderboard. No internet needed to set it.', vi: '2–16 ký tự: chữ (có dấu), số, dấu cách, _ . -<br>Tên hiện trên bảng xếp hạng online. Không cần mạng để đặt tên.' },
  'name.play': { en: 'Play', vi: 'Vào game' },
  'name.invalid': { en: 'Invalid name (2–16 characters, no special characters)', vi: 'Tên chưa hợp lệ (2–16 ký tự, không dùng ký tự đặc biệt)' },
  'maps.title': { en: 'Maps', vi: 'Bản đồ' },
  'maps.needsApp': { en: 'Needs a newer version of the game', vi: 'Cần bản game mới' },
  'maps.conquered': { en: 'Conquered', vi: 'Đã chinh phục' },
  'achp.title': { en: 'Achievements', vi: 'Thành tích' },
  'achp.mode': { en: 'Challenge mode · {got}/{n}', vi: 'Chế độ Thử thách · {got}/{n}' },
  'lb.title': { en: 'Leaderboard', vi: 'Bảng xếp hạng' },
  'lb.challenge': { en: 'Challenge', vi: 'Thử thách' },
  'lb.adventure': { en: 'Adventure', vi: 'Phiêu lưu' },
  'lb.height': { en: 'Height', vi: 'Độ cao' },
  'lb.name': { en: 'Name: {name}', vi: 'Tên: {name}' },
  'lb.noServer': { en: 'The online leaderboard is not connected to a server yet.', vi: 'Bảng xếp hạng online chưa được kết nối máy chủ.' },
  'lb.loading': { en: 'Loading…', vi: 'Đang tải…' },
  'lb.offline': { en: 'No internet and no board saved on this device yet.<br>Your results will be sent when you are online.', vi: 'Không có mạng và chưa có bảng nào được lưu trên máy.<br>Kết quả của bạn sẽ được gửi khi có mạng.' },
  'lb.you': { en: 'You', vi: 'Bạn' },
  'lb.cached': { en: 'Offline – board saved at {at}', vi: 'Ngoại tuyến – bảng lưu lúc {at}' },
  'lb.total': { en: '{n} players · updated {ago}', vi: '{n} người chơi · cập nhật {ago}' },
  'lb.empty': { en: 'Nobody on this board yet. Be the first!', vi: 'Chưa có ai trên bảng này. Hãy là người đầu tiên!' },
  'ago.never': { en: 'never', vi: 'chưa từng' },
  'ago.now': { en: 'just now', vi: 'vừa xong' },
  'ago.min': { en: '{n} min ago', vi: '{n} phút trước' },
  'ago.hour': { en: '{n} h ago', vi: '{n} giờ trước' },
  // content errors
  'err.notFound': { en: 'Map not found on the server', vi: 'Không tìm thấy map trên máy chủ' },
  'err.needsApp': { en: 'Update the app to play this map', vi: 'Cần cập nhật ứng dụng để chơi map này' },
  'err.size': { en: 'wrong size', vi: 'kích thước sai' },
  'err.hash': { en: 'checksum mismatch', vi: 'mã kiểm tra sai' },
  'err.manifest': { en: 'pack manifest does not match', vi: 'pack manifest không khớp' },
  // admin (developer tools)
  'adm.min': { en: 'Collapse', vi: 'Thu gọn' },
  'adm.close': { en: 'Close', vi: 'Đóng' },
  'adm.fly': { en: 'Fly (F)', vi: 'Bay (F)' },
  'adm.drop': { en: 'Drop (F)', vi: 'Thả xuống (F)' },
  'adm.ground': { en: 'Put down (G)', vi: 'Đặt xuống (G)' },
  'adm.redo': { en: 'Drop again (T)', vi: 'Thả lại (T)' },
  'adm.go': { en: 'Go', vi: 'Đi' },
  'adm.mark': { en: 'Save point (B)', vi: 'Lưu điểm (B)' },
  'adm.copy': { en: 'Copy coordinates', vi: 'Copy toạ độ' },
  'adm.speed': { en: 'Speed ×{k}', vi: 'Tốc độ ×{k}' },
  'adm.clear': { en: 'Clear saved points', vi: 'Xoá điểm đã lưu' },
  'adm.lock': { en: 'Lock admin', vi: 'Khoá admin' },
  'adm.help': { en: 'Fly: WASD/stick · Space/UP · C/DOWN · Shift fast. F again = drop the character and play on. A run that used admin is a TEST run and sets no records.', vi: 'Bay: WASD/cần · Space/LÊN · C/XUỐNG · Shift nhanh. F lần nữa = thả nhân vật chơi tiếp. Lượt có dùng admin là lượt TEST, không lưu kỷ lục.' },
  'adm.cleared': { en: 'Saved points cleared', vi: 'Đã xoá các điểm đã lưu' },
  'adm.password': { en: 'Admin password', vi: 'Mật khẩu admin' },
  'adm.remember': { en: 'Remember on this device', vi: 'Ghi nhớ trên thiết bị này' },
  'adm.unlock': { en: 'Unlock', vi: 'Mở khoá' },
  'adm.noChallenge': { en: 'Admin is not available in Challenge', vi: 'Admin không dùng trong Thử thách' },
  'adm.noChallengeSub': { en: 'Challenge mode has no teleporting', vi: 'Chế độ Thử thách không có dịch chuyển' },
  'adm.wrong': { en: 'Wrong password', vi: 'Sai mật khẩu' },
  'adm.on': { en: 'Admin mode unlocked', vi: 'Đã mở chế độ admin' },
  'adm.onSub': { en: 'F: fly / drop · G: put down · T: drop again · B: save point', vi: 'F: bay / thả · G: đặt xuống · T: thả lại · B: lưu điểm' },
  'adm.off': { en: 'Admin mode locked', vi: 'Đã khoá chế độ admin' },
  'adm.noGround': { en: 'No ground below', vi: 'Không có mặt đất bên dưới' },
  'adm.noDrop': { en: 'No drop point yet', vi: 'Chưa có điểm thả' },
  'adm.noDropSub': { en: 'Fly somewhere, then press F to drop', vi: 'Bay tới một chỗ rồi bấm F để thả' },
  'adm.teleport': { en: 'Teleport', vi: 'Dịch chuyển' },
  'adm.point': { en: 'Point {n} · {y} m', vi: 'Điểm {n} · {y} m' },
  'adm.saved': { en: 'Point saved', vi: 'Đã lưu điểm' },
  'adm.copied': { en: 'Coordinates copied', vi: 'Đã copy toạ độ' },
  'adm.coords': { en: 'Coordinates', vi: 'Toạ độ' },
  'adm.goto': { en: '— Teleport to… —', vi: '— Dịch chuyển tới… —' },
  'adm.marks': { en: 'Saved points', vi: 'Điểm đã lưu' },
  'adm.zone': { en: 'Zone', vi: 'Khu' },
} satisfies Record<string, Entry>;

export type StrKey = keyof typeof STR;

/** UI text in the current language; {name} placeholders are filled from vars */
export function t(key: StrKey, vars?: Record<string, string | number>): string {
  const e: Entry = STR[key];
  let s = e[cur] ?? e.en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}
