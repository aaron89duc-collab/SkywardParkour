import type { ZoneData } from '../world/MapTypes';
import type { SyncView } from '../content/AutoSync';
import type { SaveData, GameMode } from '../systems/Score';
import type { Quality } from '../config';
import { fullscreenSupported, isFullscreen, isIOS, isStandalone } from './Fullscreen';
import type { OnlineUI } from './OnlineUI';

/** Menu facts that depend on maps on the device / the player profile (provided by the game). */
export type MenuInfo = {
  name: string | null;
  tag?: string;
  /** maps the player may start from (unlocked and on the device), above the first one */
  continueFrom: { id: string; name: string; y: number }[];
  conquered: string | null;
  bestTime: { label: string; value: number } | null;
  mode: GameMode;
  challengeBest: number;
  achievements: { got: number; total: number };
};

export type UIHandlers = {
  onStart: (mapId?: string, mode?: GameMode) => void;
  onAchievements?: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onCharacter: (c: 'male' | 'female') => void;
  onVolume: (v: number) => void;
  onQuality: (q: Quality) => void;
  onSensitivity: (v: number) => void;
  onShowFps: (v: boolean) => void;
  onAutoCam: (v: boolean) => void;
  onPause: () => void;
  onClick: () => void;
  onFullscreen: () => void;
  menuInfo?: () => MenuInfo;
};

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** DOM overlay: loading, main menu, HUD (height + altitude bar), pause, settings, toasts, finish. */
export class UI {
  root: HTMLElement;
  private loading: HTMLDivElement;
  private loadBar: HTMLDivElement;
  private loadTip: HTMLDivElement;
  private menu: HTMLDivElement;
  private syncPill: HTMLDivElement;
  private hud: HTMLDivElement;
  private pause: HTMLDivElement;
  private settings: HTMLDivElement;
  private finish: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private speed: HTMLDivElement;
  private hudCur!: HTMLElement;
  private hudLines!: HTMLElement;
  private hudZone!: HTMLElement;
  private hint!: HTMLElement;
  private fps!: HTMLElement;
  private altMe!: HTMLElement;
  private altMax!: HTMLElement;
  private altPb!: HTMLElement;
  private mapY0 = 0;
  private mapHeight = 140;
  private settingsReturn: 'menu' | 'pause' = 'menu';
  private rotate!: HTMLDivElement;
  private rotateDismissed = false;
  private character: 'male' | 'female' = 'male';
  private quality: Quality = 'high';
  private save: SaveData | null = null;
  bindSave(s: SaveData, q: Quality) { this.save = s; this.quality = q; }
  /** name / maps / leaderboard panels (set by the game) */
  online: OnlineUI | null = null;
  private menuArgs: [SaveData, Record<string, string>, Quality] | null = null;

  /** content or profile changed: refresh the menu (if shown) and the maps panel */
  refreshMaps() {
    this.online?.refresh();
    if (this.menuArgs && !this.menu.classList.contains('hidden')) this.showMenu(...this.menuArgs);
  }

  constructor(parent: HTMLElement, private h: UIHandlers, private touch: boolean) {
    this.root = parent;
    // loading
    this.loading = el('div', 'loading', `<div class="logo"><span class="l1">Skyward</span><span class="l2">Parkour</span></div>
      <div class="bar"><div></div></div><div class="tip">Đang tải Starter Village…</div>`);
    this.loadBar = this.loading.querySelector('.bar > div') as HTMLDivElement;
    this.loadTip = this.loading.querySelector('.tip') as HTMLDivElement;
    parent.appendChild(this.loading);

    // menu
    this.menu = el('div', 'menu hidden');
    parent.appendChild(this.menu);

    // background map download / offline warning (menu + HUD, never blocks a tap)
    this.syncPill = el('div', 'sync-pill hidden');
    parent.appendChild(this.syncPill);

    // hud
    this.hud = el('div', 'hud hidden', `
      <div class="height"><div class="cur">0<small>m</small></div><span class="test-badge hidden">TEST</span><span class="mode-badge hidden">THỬ THÁCH</span><div class="lines"></div></div>
      <div class="zone"></div>
      <button class="pause-btn" aria-label="Tạm dừng">II</button>
      <button class="fs-btn" aria-label="Toàn màn hình"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <div class="altbar"></div>
      <div class="hint hidden"></div>
      <div class="fps hidden"></div>`);
    parent.appendChild(this.hud);
    this.hudCur = this.hud.querySelector('.cur')!;
    this.hudLines = this.hud.querySelector('.lines')!;
    this.hudZone = this.hud.querySelector('.zone')!;
    this.hint = this.hud.querySelector('.hint')!;
    this.fps = this.hud.querySelector('.fps')!;
    (this.hud.querySelector('.pause-btn') as HTMLButtonElement).addEventListener('click', () => { this.h.onClick(); this.h.onPause(); });
    const fsBtn = this.hud.querySelector('.fs-btn') as HTMLButtonElement;
    if (!fullscreenSupported() || isStandalone()) fsBtn.classList.add('hidden');
    fsBtn.addEventListener('click', () => { this.h.onClick(); this.h.onFullscreen(); });

    // portrait warning on phones
    this.rotate = el('div', 'rotate-overlay hidden', `<div class="phone"></div><div class="rt1">Xoay ngang điện thoại</div><div class="rt2">Skyward Parkour chơi tốt nhất ở màn hình ngang</div><button class="btn secondary">Vẫn chơi màn hình dọc</button>`);
    (this.rotate.querySelector('button') as HTMLButtonElement).addEventListener('click', () => { this.h.onClick(); this.rotateDismissed = true; this.updateOrientation(); });
    parent.appendChild(this.rotate);
    const upd = () => this.updateOrientation();
    window.addEventListener('resize', upd);
    window.addEventListener('orientationchange', upd);
    this.updateOrientation();

    this.speed = el('div', 'speedlines');
    parent.appendChild(this.speed);
    this.toastEl = el('div', 'toast', '<div class="t1"></div><div class="t2"></div>');
    parent.appendChild(this.toastEl);

    this.pause = el('div', 'overlay hidden');
    parent.appendChild(this.pause);
    this.settings = el('div', 'overlay hidden');
    parent.appendChild(this.settings);
    this.finish = el('div', 'overlay hidden');
    parent.appendChild(this.finish);
  }

  /** the only thing players ever see of map downloads: a warning while maps ahead are missing offline */
  setSync(v: SyncView) {
    const p = this.syncPill;
    if (v.kind !== 'offline') { p.classList.add('hidden'); return; }
    const what = v.names.length === 1 ? `<b>${esc(v.names[0])}</b>` : v.names.length > 1 ? `${v.names.length} map tiếp theo` : 'map tiếp theo';
    p.dataset.kind = v.kind;
    p.innerHTML = `<span class="ic"></span><span class="tx">Không có mạng – chưa tải được ${what}<small>Bật mạng internet, game sẽ tự tải về</small></span>`;
    p.classList.remove('hidden');
  }

  updateOrientation() {
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    this.rotate.classList.toggle('hidden', !(this.touch && portrait && !this.rotateDismissed));
  }

  // ---------------- loading
  setLoading(p: number, tip?: string) {
    this.loadBar.style.width = `${Math.round(p * 100)}%`;
    if (tip) this.loadTip.textContent = tip;
  }
  showLoading(tip: string) {
    this.loading.classList.remove('hidden', 'fade');
    this.setLoading(0.5, tip);
  }
  hideLoading() {
    this.loading.classList.add('fade');
    setTimeout(() => this.loading.classList.add('hidden'), 700);
  }
  showError(msg: string) {
    this.loading.classList.remove('hidden', 'fade');
    this.loadTip.textContent = msg;
  }

  // ---------------- menu
  showMenu(save: SaveData, portraits: Record<string, string>, quality: Quality) {
    this.menuArgs = [save, portraits, quality];
    const info: MenuInfo = this.h.menuInfo?.() ?? { name: null, continueFrom: [], conquered: null, bestTime: null, mode: 'adventure', challengeBest: 0, achievements: { got: 0, total: 0 } };
    this.character = save.character;
    this.quality = quality;
    const best = save.personalBest;
    const ctrls = this.touch
      ? 'Cần điều khiển trái: di chuyển · Vuốt phải: xoay camera · NHẢY / LEO'
      : '<kbd>W A S D</kbd> di chuyển · <kbd>Space</kbd> nhảy (giữ lâu nhảy cao) / leo lên · <kbd>E</kbd>/<kbd>Shift</kbd> buông mép, trèo xuống mép · Chuột: xoay camera · Cuộn: zoom · <kbd>Esc</kbd> tạm dừng';
    const img = (k: string) => (portraits[k] ? `<img src="${portraits[k]}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:12px;display:block;margin:0 auto">` : '');
    this.menu.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center">
        <div class="logo"><span class="l1">Skyward</span><span class="l2">Parkour</span></div>
        <div class="sub">Leo cao không giới hạn · rơi không chết</div>
        ${info.name ? `<button class="player-chip" data-a="name">${esc(info.name)}${info.tag ? ` <i>#${esc(info.tag)}</i>` : ''} · <u>Đổi tên</u></button>` : ''}
      </div>
      <div class="center">
        <div class="chars">
          <button class="char ${this.character === 'male' ? 'sel' : ''}" data-c="male">${img('male')}<div class="nm">Nhân vật nam</div><div class="ds">Kai</div></button>
          <button class="char ${this.character === 'female' ? 'sel' : ''}" data-c="female">${img('female')}<div class="nm">Nhân vật nữ</div><div class="ds">Mia</div></button>
        </div>
        <div class="modes">
          <button class="btn mode ${info.mode === 'adventure' ? 'last' : ''}" data-mode="adventure"><b>PHIÊU LƯU</b><span>Chơi tự do · tiếp tục từ map đã chinh phục</span></button>
          <button class="btn mode challenge ${info.mode === 'challenge' ? 'last' : ''}" data-mode="challenge"><b>THỬ THÁCH</b><span>Luôn từ 0 m · rơi bao nhiêu leo lại bấy nhiêu</span></button>
        </div>
        ${info.continueFrom.map((c) => `<button class="btn secondary city" data-cont="${c.id}">Phiêu lưu tiếp từ ${esc(c.name)} · ${Math.round(c.y)} m</button>`).join('')}
        ${this.touch && isIOS() && !isStandalone() ? '<div class="ios-tip">iPhone: bấm <b>Chia sẻ</b> → <b>Thêm vào MH chính</b> để chơi toàn màn hình</div>' : ''}
        <div class="row"><button class="btn secondary" data-a="maps">Bản đồ</button><button class="btn secondary" data-a="lb">Bảng xếp hạng</button><button class="btn secondary" data-a="ach">Thành tích ${info.achievements.got}/${info.achievements.total}</button><button class="btn secondary" data-a="settings">Cài đặt</button></div>
        <div class="stats">
          <div class="stat"><b>${best.toFixed(0)} m</b><span>Kỷ lục Phiêu lưu</span></div>
          <div class="stat"><b>${info.challengeBest.toFixed(0)} m</b><span>Kỷ lục Thử thách</span></div>
          <div class="stat"><b>${info.conquered ? `${esc(info.conquered)} ✓` : '—'}</b><span>Map cao nhất đã chinh phục</span></div>
          <div class="stat"><b>${info.bestTime ? fmtTime(info.bestTime.value) : '—'}</b><span>${info.bestTime ? esc(info.bestTime.label) : 'Thời gian tốt nhất'}</span></div>
        </div>
      </div>
      <div class="controls-help">${ctrls}<br>Rơi không chết – rơi xuống đâu, chơi tiếp ở đó. Không có checkpoint.</div>`;
    this.menu.querySelectorAll<HTMLButtonElement>('.char').forEach((b) =>
      b.addEventListener('click', () => {
        this.h.onClick();
        this.character = b.dataset.c as 'male' | 'female';
        this.menu.querySelectorAll('.char').forEach((x) => x.classList.toggle('sel', x === b));
        this.h.onCharacter(this.character);
      }),
    );
    this.menu.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.h.onClick(); this.h.onStart(undefined, b.dataset.mode as GameMode); }));
    this.menu.querySelectorAll<HTMLButtonElement>('[data-cont]').forEach((b) => b.addEventListener('click', () => { this.h.onClick(); this.h.onStart(b.dataset.cont, 'adventure'); }));
    this.menu.querySelector('[data-a=ach]')?.addEventListener('click', () => { this.h.onClick(); this.h.onAchievements?.(); });
    this.menu.querySelector('[data-a=maps]')?.addEventListener('click', () => { this.h.onClick(); this.online?.openMaps(); });
    this.menu.querySelector('[data-a=lb]')?.addEventListener('click', () => { this.h.onClick(); this.online?.openLeaderboard(); });
    this.menu.querySelector('[data-a=name]')?.addEventListener('click', () => { this.h.onClick(); if (this.online) { this.online.onNameSet = () => this.refreshMaps(); this.online.openName(); } });
    (this.menu.querySelector('[data-a=settings]') as HTMLButtonElement).addEventListener('click', () => { this.h.onClick(); this.openSettings('menu'); });
    this.menu.classList.remove('hidden');
  }
  hideMenu() { this.menu.classList.add('hidden'); }

  // ---------------- HUD
  /** Altitude bar for the map the player is in: world heights y0..y1 with its zone bands. */
  setupHUD(zones: ZoneData[], y0: number, y1: number, personalBest: number) {
    this.mapY0 = y0;
    this.mapHeight = y1 - y0;
    const H = this.mapHeight;
    const bar = this.hud.querySelector('.altbar') as HTMLDivElement;
    bar.innerHTML = '';
    for (const z of zones) {
      const lo = Math.max(z.y0, y0) - y0, hi = Math.min(z.y1, y1) - y0;
      if (hi <= lo) continue;
      const b = el('div', 'band');
      b.style.bottom = `${(lo / H) * 100}%`;
      b.style.height = `${((hi - lo) / H) * 100}%`;
      b.style.background = z.color;
      b.title = z.name;
      bar.appendChild(b);
      const t = el('div', 'tick', z.id);
      t.style.bottom = `${((lo + hi) / 2 / H) * 100}%`;
      bar.appendChild(t);
    }
    this.altMax = el('div', 'max');
    this.altPb = el('div', 'pb', '★');
    this.altMe = el('div', 'me');
    bar.append(this.altMax, this.altPb, this.altMe);
    this.updatePB(personalBest);
  }
  updatePB(pb: number) {
    if (this.altPb) {
      this.altPb.style.bottom = `${Math.max(0, Math.min(100, ((pb - this.mapY0) / this.mapHeight) * 100))}%`;
      this.altPb.style.display = pb < this.mapY0 - 0.5 ? 'none' : '';
    }
  }
  showHUD(v: boolean) { this.hud.classList.toggle('hidden', !v); }
  /** the height counter (admin's hidden 5-tap entry point on phones) */
  get hudHeightEl() { return this.hud.querySelector('.height') as HTMLElement; }
  /** Challenge run: badge next to the height */
  setModeBadge(on: boolean) { (this.hud.querySelector('.mode-badge') as HTMLElement).classList.toggle('hidden', !on); }
  /** admin test run: nothing is being recorded */
  setTestBadge(on: boolean) { (this.hud.querySelector('.test-badge') as HTMLElement).classList.toggle('hidden', !on); }

  updateHUD(s: { current: number; runMax: number; best: number; time: number; zone: ZoneData | null; fps?: number }) {
    this.hudCur.innerHTML = `${s.current.toFixed(0)}<small>m</small>`;
    this.hudLines.innerHTML = `Kỷ lục lượt: <b>${s.runMax.toFixed(0)} m</b><br>Kỷ lục cá nhân: <b>${s.best.toFixed(0)} m</b><br>Thời gian: ${fmtTime(s.time)}`;
    if (s.zone) this.hudZone.innerHTML = `<i style="background:${s.zone.color}"></i>Khu ${s.zone.id} – ${s.zone.name}`;
    const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - this.mapY0) / this.mapHeight) * 100))}%`;
    this.altMe.style.bottom = pct(s.current);
    this.altMax.style.bottom = pct(s.runMax);
    this.updatePB(s.best);
    if (s.fps !== undefined) { this.fps.classList.remove('hidden'); this.fps.textContent = `${s.fps.toFixed(0)} FPS`; } else this.fps.classList.add('hidden');
  }

  setHint(text: string | null) {
    if (!text) { this.hint.classList.add('hidden'); return; }
    this.hint.textContent = text;
    this.hint.classList.remove('hidden');
  }

  setSpeedLines(k: number) { this.speed.style.opacity = `${Math.min(1, k)}`; }

  toast(t1: string, t2 = '', gold = false, ms = 2600) {
    (this.toastEl.querySelector('.t1') as HTMLElement).textContent = t1;
    (this.toastEl.querySelector('.t2') as HTMLElement).textContent = t2;
    this.toastEl.classList.toggle('gold', gold);
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  // ---------------- pause
  showPause(character: 'male' | 'female') {
    this.character = character;
    this.pause.innerHTML = `<div class="panel"><h2>Tạm dừng</h2><div class="stack">
      <button class="btn" data-a="resume">Tiếp tục</button>
      <button class="btn secondary" data-a="char">Đổi nhân vật: ${character === 'male' ? 'Nam → Nữ' : 'Nữ → Nam'}</button>
      <button class="btn secondary" data-a="settings">Cài đặt</button>
      ${fullscreenSupported() && !isStandalone() ? `<button class="btn secondary" data-a="fs">${isFullscreen() ? 'Thoát toàn màn hình' : 'Toàn màn hình'}</button>` : ''}
      <button class="btn secondary" data-a="restart">Chơi lại từ đầu</button>
      <button class="btn secondary" data-a="menu">Về menu chính</button>
    </div><div class="note">Đổi nhân vật giữ nguyên vị trí và điểm hiện tại.</div></div>`;
    const on = (a: string, f: () => void) => (this.pause.querySelector(`[data-a=${a}]`) as HTMLButtonElement).addEventListener('click', () => { this.h.onClick(); f(); });
    on('resume', () => this.h.onResume());
    on('char', () => {
      const next = this.character === 'male' ? 'female' : 'male';
      this.h.onCharacter(next);
      this.showPause(next);
    });
    on('settings', () => { this.pause.classList.add('hidden'); this.openSettings('pause'); });
    if (this.pause.querySelector('[data-a=fs]')) on('fs', () => { this.h.onFullscreen(); setTimeout(() => this.showPause(this.character), 300); });
    on('restart', () => {
      const b = this.pause.querySelector('[data-a=restart]') as HTMLButtonElement;
      if (b.dataset.confirm) this.h.onRestart();
      else { b.dataset.confirm = '1'; b.textContent = 'Bấm lần nữa để xác nhận'; }
    });
    on('menu', () => this.h.onMainMenu());
    this.pause.classList.remove('hidden');
  }
  hidePause() { this.pause.classList.add('hidden'); this.settings.classList.add('hidden'); }

  // ---------------- settings
  openSettings(from: 'menu' | 'pause', save?: SaveData) {
    this.settingsReturn = from;
    const s = (save ?? this.save!).settings;
    const q = this.quality;
    this.settings.innerHTML = `<div class="panel"><h2>Cài đặt</h2>
      <div class="set-row"><span>Âm lượng</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="vol"></div>
      <div class="set-row"><span>Đồ họa</span><div class="seg" data-k="q">
        <button data-v="low" class="${q === 'low' ? 'on' : ''}">Thấp</button><button data-v="medium" class="${q === 'medium' ? 'on' : ''}">Vừa</button><button data-v="high" class="${q === 'high' ? 'on' : ''}">Cao</button></div></div>
      <div class="set-row"><span>Độ nhạy camera</span><input type="range" min="0.4" max="2" step="0.1" value="${s.sensitivity}" data-k="sens"></div>
      <div class="set-row"><span>Camera tự căn khi chạy thẳng</span><input type="checkbox" ${(s.autoCam ?? this.touch) ? 'checked' : ''} data-k="autocam"></div>
      <div class="set-row"><span>Hiện FPS</span><input type="checkbox" ${s.showFps ? 'checked' : ''} data-k="fps"></div>
      <div class="stack" style="margin-top:14px"><button class="btn" data-a="back">Xong</button></div></div>`;
    (this.settings.querySelector('[data-k=vol]') as HTMLInputElement).addEventListener('input', (e) => this.h.onVolume(parseFloat((e.target as HTMLInputElement).value)));
    (this.settings.querySelector('[data-k=sens]') as HTMLInputElement).addEventListener('input', (e) => this.h.onSensitivity(parseFloat((e.target as HTMLInputElement).value)));
    (this.settings.querySelector('[data-k=fps]') as HTMLInputElement).addEventListener('change', (e) => this.h.onShowFps((e.target as HTMLInputElement).checked));
    (this.settings.querySelector('[data-k=autocam]') as HTMLInputElement).addEventListener('change', (e) => this.h.onAutoCam((e.target as HTMLInputElement).checked));
    this.settings.querySelectorAll<HTMLButtonElement>('[data-k=q] button').forEach((b) =>
      b.addEventListener('click', () => {
        this.h.onClick();
        this.quality = b.dataset.v as Quality;
        this.settings.querySelectorAll('[data-k=q] button').forEach((x) => x.classList.toggle('on', x === b));
        this.h.onQuality(this.quality);
      }),
    );
    (this.settings.querySelector('[data-a=back]') as HTMLButtonElement).addEventListener('click', () => {
      this.h.onClick();
      this.settings.classList.add('hidden');
      if (this.settingsReturn === 'pause') this.pause.classList.remove('hidden');
    });
    this.settings.classList.remove('hidden');
  }

  // ---------------- finish
  showFinish(stats: { title: string; time: number; best: number; bestTime: number | null; firstTime: boolean; next: string; hint: string }, onContinue: () => void, onAgain: () => void) {
    this.finish.innerHTML = `<div class="panel finish"><h2>${stats.title}</h2>
      <div class="big">${fmtTime(stats.time)}</div>
      <div class="note" style="margin-top:0">Thời gian leo lượt này${stats.bestTime ? ` · Tốt nhất: ${fmtTime(stats.bestTime)}` : ''}</div>
      <div class="next">${stats.next}</div>
      <div class="stack"><button class="btn" data-a="cont">Tiếp tục khám phá</button><button class="btn secondary" data-a="again">Leo lại từ đầu</button></div>
      ${stats.firstTime ? `<div class="note">${stats.hint}</div>` : ''}</div>`;
    (this.finish.querySelector('[data-a=cont]') as HTMLButtonElement).addEventListener('click', () => { this.h.onClick(); this.finish.classList.add('hidden'); onContinue(); });
    (this.finish.querySelector('[data-a=again]') as HTMLButtonElement).addEventListener('click', () => { this.h.onClick(); this.finish.classList.add('hidden'); onAgain(); });
    this.finish.classList.remove('hidden');
  }
  get finishOpen() { return !this.finish.classList.contains('hidden'); }
}
