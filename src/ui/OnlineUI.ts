import type { MapStatus, Progress } from '../content/ContentManager';
import type { BoardResult } from '../online/Leaderboard';

/** What the online parts of the menu need from the game (content manager + leaderboard). */
export interface OnlineHost {
  statuses(): MapStatus[];
  installing(): Progress | null;
  contentOnline(): boolean | null;
  checkedAt(): number;
  install(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  check(): Promise<void>;
  pendingRestart(id: string): boolean;
  restartApp(): void;
  usage(): Promise<{ used: number; quota: number } | null>;
  lbEnabled(): boolean;
  board(b: string): Promise<BoardResult | null>;
  boards(): { id: string; label: string }[];
  profile(): { name: string; tag?: string } | null;
  setName(n: string): boolean;
  click(): void;
}

const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ago = (t: number) => {
  if (!t) return 'chưa từng';
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'vừa xong';
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} giờ trước`;
  return new Date(t).toLocaleDateString('vi-VN');
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Online-related menu UI: player name, maps (download once / update / remove), new-content notice, leaderboard.
 * Everything works offline: the maps panel shows what is on the device, the leaderboard shows the last saved copy.
 */
export class OnlineUI {
  private nameBox: HTMLDivElement;
  private mapsBox: HTMLDivElement;
  private lbBox: HTMLDivElement;
  private dismissed = new Set<string>();
  private errors = new Map<string, string>();
  private lbTab = 'height';
  private lbMode: 'c' | 'a' = 'c';
  onNameSet: (() => void) | null = null;

  constructor(parent: HTMLElement, private h: OnlineHost) {
    const mk = (cls: string) => { const d = document.createElement('div'); d.className = `overlay ${cls} hidden`; parent.appendChild(d); return d; };
    this.nameBox = mk('name-box');
    this.mapsBox = mk('maps-box');
    this.lbBox = mk('lb-box');
  }

  // ---------------------------------------------------------------- name
  /** first launch (no name yet): ask for one. `force` = cannot be skipped */
  openName(force = false) {
    const cur = this.h.profile()?.name ?? '';
    const suggest = cur || `Người chơi ${Math.floor(1000 + Math.random() * 9000)}`;
    this.nameBox.innerHTML = `<div class="panel"><h2>${cur ? 'Đổi tên' : 'Đặt tên nhân vật'}</h2>
      <input class="name-input" maxlength="16" value="${esc(suggest)}" autocomplete="nickname" spellcheck="false">
      <div class="note">2–16 ký tự: chữ (có dấu), số, dấu cách, _ . -<br>Tên hiện trên bảng xếp hạng online. Không cần mạng để đặt tên.</div>
      <div class="name-err"></div>
      <div class="row" style="margin-top:12px">${force ? '' : '<button class="btn secondary" data-a="cancel">Huỷ</button>'}<button class="btn" data-a="ok">${cur ? 'Lưu' : 'Vào game'}</button></div></div>`;
    const input = this.nameBox.querySelector('.name-input') as HTMLInputElement;
    const ok = () => {
      if (!this.h.setName(input.value)) { (this.nameBox.querySelector('.name-err') as HTMLElement).textContent = 'Tên chưa hợp lệ (2–16 ký tự, không dùng ký tự đặc biệt)'; return; }
      this.h.click();
      this.nameBox.classList.add('hidden');
      this.onNameSet?.();
    };
    (this.nameBox.querySelector('[data-a=ok]') as HTMLButtonElement).addEventListener('click', ok);
    this.nameBox.querySelector('[data-a=cancel]')?.addEventListener('click', () => { this.h.click(); this.nameBox.classList.add('hidden'); });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); });
    this.nameBox.classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 60);
  }

  // ---------------------------------------------------------------- new content notice (inside the menu)
  /** HTML for the menu banner: new maps / updates found by the last online check */
  newsHtml() {
    const news = this.h.statuses().filter((s) => (s.state === 'download' || s.state === 'update') && !this.dismissed.has(`${s.id}:${s.remote?.hash}`));
    if (!news.length) return '';
    const s = news[0];
    const what = s.state === 'download' ? `Có map mới: <b>${esc(s.name)}</b>` : `Có bản cập nhật <b>${esc(s.name)}</b> v${s.remote?.version}`;
    const more = news.length > 1 ? ` <span class="more">+${news.length - 1}</span>` : '';
    return `<div class="news" data-id="${s.id}" data-hash="${s.remote?.hash ?? ''}"><span>${what} (${mb(s.bytes)})${more}</span>
      <button class="btn secondary" data-n="get">${s.state === 'download' ? 'Tải ngay' : 'Cập nhật'}</button><button class="btn secondary" data-n="later">Để sau</button></div>`;
  }

  bindNews(root: HTMLElement, rerender: () => void) {
    const n = root.querySelector('.news') as HTMLElement | null;
    if (!n) return;
    n.querySelector('[data-n=get]')?.addEventListener('click', () => { this.h.click(); this.openMaps(); void this.install(n.dataset.id!); });
    n.querySelector('[data-n=later]')?.addEventListener('click', () => { this.h.click(); this.dismissed.add(`${n.dataset.id}:${n.dataset.hash}`); rerender(); });
  }

  // ---------------------------------------------------------------- maps panel
  openMaps() {
    this.mapsBox.classList.remove('hidden');
    this.renderMaps();
  }

  /** called when content state changes (progress, check finished, install done) */
  refresh() { if (!this.mapsBox.classList.contains('hidden')) this.renderMaps(); }

  private async install(id: string) {
    this.errors.delete(id);
    try { await this.h.install(id); } catch (e) { this.errors.set(id, (e as Error).message || 'Tải thất bại'); }
    this.refresh();
  }

  private renderMaps() {
    const st = this.h.statuses();
    const prog = this.h.installing();
    const on = this.h.contentOnline();
    const rows = st.map((s) => {
      let chip = '', btn = '';
      const busy = prog?.id === s.id;
      if (s.state === 'ready') {
        chip = s.source === 'bundled' ? `Có sẵn trong app · v${s.version}` : `Đã tải · v${s.version}`;
        if (s.source === 'pack') btn = `<button class="mini" data-m="remove" data-id="${s.id}">Xoá</button>`;
        if (this.h.pendingRestart(s.id)) { chip = `Đã cập nhật v${s.version} – mở lại game để dùng`; btn = `<button class="mini on" data-m="restart">Mở lại</button>`; }
      } else if (s.state === 'update') {
        chip = `Có bản v${s.remote?.version} · ${mb(s.bytes)}`;
        btn = `<button class="mini on" data-m="get" data-id="${s.id}">Cập nhật</button>`;
      } else if (s.state === 'download') {
        chip = `Chưa tải · ${mb(s.bytes)}`;
        btn = `<button class="mini on" data-m="get" data-id="${s.id}">Tải về</button>`;
      } else if (s.state === 'needs-app') chip = 'Cần cập nhật ứng dụng';
      else if (s.state === 'needs-previous') chip = 'Cần tải map phía dưới trước';
      if (busy) { btn = ''; chip = `Đang tải… ${Math.floor((prog!.done / Math.max(1, prog!.total)) * 100)}% (${prog!.filesDone}/${prog!.files} tệp)`; }
      if ((s.state === 'download' || s.state === 'update') && on === false && !busy) btn = '';
      const err = this.errors.get(s.id);
      return `<div class="map-row ${s.state}">
        <div class="mr-main"><div class="mr-name">${s.order}. ${esc(s.name)} <span class="mr-y">${Math.max(0, Math.round(s.yMin / 10) * 10)} m</span></div>
        ${s.summary ? `<div class="mr-sum">${esc(s.summary)}</div>` : ''}
        <div class="mr-chip">${chip}</div>
        ${busy ? `<div class="mr-bar"><div style="width:${(prog!.done / Math.max(1, prog!.total)) * 100}%"></div></div>` : ''}
        ${err ? `<div class="mr-err">${esc(err)} – map cũ vẫn giữ nguyên, thử lại sau.</div>` : ''}</div>
        <div class="mr-act">${btn}</div></div>`;
    }).join('');
    const status = on === true ? `Trực tuyến · đã kiểm tra ${ago(this.h.checkedAt())}`
      : on === false ? 'Ngoại tuyến – các map đã có trên máy vẫn chơi bình thường'
        : 'Đang kiểm tra map mới…';
    this.mapsBox.innerHTML = `<div class="panel maps-panel"><h2>Bản đồ</h2>
      <div class="maps-list">${rows}</div>
      <div class="maps-status"><span>${status}</span><button class="mini" data-m="check">Kiểm tra lại</button></div>
      <div class="note">Tải một lần, chơi offline. Có mạng thì game tự báo map mới và bản cập nhật; bản cũ chỉ bị thay khi bản mới đã tải xong và kiểm tra đầy đủ.<span class="usage"></span></div>
      <div class="stack" style="margin-top:12px"><button class="btn" data-m="close">Xong</button></div></div>`;
    this.mapsBox.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
      this.h.click();
      const a = b.dataset.m, id = b.dataset.id!;
      if (a === 'close') this.mapsBox.classList.add('hidden');
      else if (a === 'get') void this.install(id);
      else if (a === 'remove') void this.h.remove(id).then(() => this.refresh());
      else if (a === 'restart') this.h.restartApp();
      else if (a === 'check') { b.disabled = true; void this.h.check().then(() => this.refresh()); }
    }));
    void this.h.usage().then((u) => {
      const e = this.mapsBox.querySelector('.usage');
      if (u && e && u.quota) e.textContent = ` Đang dùng ${mb(u.used)} bộ nhớ.`;
    });
  }

  // ---------------------------------------------------------------- achievements (Challenge)
  openAchievements(items: { title: string; desc: string; at: number | null }[]) {
    const got = items.filter((i) => i.at).length;
    this.lbBox.innerHTML = `<div class="panel lb-panel"><h2>Thành tích</h2>
      <div class="lb-foot" style="margin:-4px 0 10px">Chế độ Thử thách · ${got}/${items.length}</div>
      <div class="lb-list ach-list">${items.map((i) => `<div class="ach ${i.at ? 'got' : ''}"><b>${i.at ? '★' : '☆'} ${esc(i.title)}</b><span>${esc(i.desc)}${i.at ? ` · ${new Date(i.at).toLocaleDateString('vi-VN')}` : ''}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn" data-a="close">Xong</button></div></div>`;
    (this.lbBox.querySelector('[data-a=close]') as HTMLButtonElement).addEventListener('click', () => { this.h.click(); this.lbBox.classList.add('hidden'); });
    this.lbBox.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- leaderboard
  openLeaderboard() {
    this.lbBox.classList.remove('hidden');
    void this.renderLb();
  }

  private async renderLb() {
    const tabs = this.h.boards();
    if (!tabs.some((t) => t.id === this.lbTab)) this.lbTab = tabs[0]?.id ?? 'height';
    const me = this.h.profile();
    const shell = (body: string, foot: string) => {
      this.lbBox.innerHTML = `<div class="panel lb-panel"><h2>Bảng xếp hạng</h2>
        <div class="seg lb-tabs lb-modes"><button data-md="c" class="${this.lbMode === 'c' ? 'on' : ''}">Thử thách</button><button data-md="a" class="${this.lbMode === 'a' ? 'on' : ''}">Phiêu lưu</button></div>
        <div class="seg lb-tabs">${tabs.map((t) => `<button data-t="${t.id}" class="${t.id === this.lbTab ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</div>
        <div class="lb-body">${body}</div><div class="lb-foot">${foot}</div>
        <div class="row" style="margin-top:12px"><button class="btn secondary" data-a="name">Tên: ${esc(me?.name ?? '—')}${me?.tag ? ` #${me.tag}` : ''}</button><button class="btn" data-a="close">Xong</button></div></div>`;
      this.lbBox.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.addEventListener('click', () => { this.h.click(); this.lbTab = b.dataset.t!; void this.renderLb(); }));
      this.lbBox.querySelectorAll<HTMLButtonElement>('[data-md]').forEach((b) => b.addEventListener('click', () => { this.h.click(); this.lbMode = b.dataset.md as 'a' | 'c'; void this.renderLb(); }));
      (this.lbBox.querySelector('[data-a=close]') as HTMLButtonElement).addEventListener('click', () => { this.h.click(); this.lbBox.classList.add('hidden'); });
      (this.lbBox.querySelector('[data-a=name]') as HTMLButtonElement).addEventListener('click', () => { this.h.click(); this.onNameSet = () => { this.onNameSet = null; void this.renderLb(); }; this.openName(); });
    };
    if (!this.h.lbEnabled()) { shell('<div class="lb-empty">Bảng xếp hạng online chưa được kết nối máy chủ.</div>', ''); return; }
    shell('<div class="lb-empty">Đang tải…</div>', '');
    const tab = this.lbTab, mode = this.lbMode;
    const r = await this.h.board(`${mode}|${tab}`);
    if (tab !== this.lbTab || mode !== this.lbMode || this.lbBox.classList.contains('hidden')) return;
    const isTime = tab.startsWith('time:');
    const val = (v: number) => (isTime ? fmtTime(v) : `${v.toFixed(1)} m`);
    if (!r) { shell('<div class="lb-empty">Không có mạng và chưa có bảng nào được lưu trên máy.<br>Kết quả của bạn sẽ được gửi khi có mạng.</div>', ''); return; }
    const rows = r.entries.map((e) => `<div class="lb-row ${e.me ? 'me' : ''}"><span class="r">${e.rank}</span><span class="n">${esc(e.name)} <i>#${esc(e.tag)}</i></span><span class="v">${val(e.v)}</span></div>`).join('');
    const mine = r.me && !r.entries.some((e) => e.me) ? `<div class="lb-row me"><span class="r">${r.me.rank}</span><span class="n">Bạn</span><span class="v">${val(r.me.v)}</span></div>` : '';
    const foot = (r.cached ? `Ngoại tuyến – bảng lưu lúc ${new Date(r.at).toLocaleString('vi-VN')}` : `${r.total} người chơi · cập nhật ${ago(r.at)}`);
    shell(rows || mine ? `<div class="lb-list">${rows}${mine}</div>` : '<div class="lb-empty">Chưa có ai trên bảng này. Hãy là người đầu tiên!</div>', foot);
  }
}
