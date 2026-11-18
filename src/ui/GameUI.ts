export class GameUI {
  readonly loading = document.getElementById('loading')!;
  private readonly screen = document.getElementById('screen')!;
  private readonly title = document.getElementById('screen-title')!;
  private readonly message = document.getElementById('screen-text')!;
  private readonly play = document.getElementById('play-button') as HTMLButtonElement;
  private readonly reset = document.getElementById('reset-button') as HTMLButtonElement;
  private readonly menu = document.getElementById('menu-button') as HTMLButtonElement;
  private readonly current = document.getElementById('height')!;
  private readonly record = document.getElementById('record')!;
  private readonly status = document.getElementById('status')!;
  private readonly toast = document.getElementById('toast')!;
  private toastTimeout: number | undefined;

  constructor(onStart: () => void, onReset: () => void, onMenu: () => void) {
    this.play.addEventListener('click', onStart);
    this.reset.addEventListener('click', onReset);
    this.menu.addEventListener('click', onMenu);
  }

  ready(): void { this.loading.hidden = true; }

  showError(message: string): void {
    this.loading.innerHTML = `<div style="padding:25px;max-width:420px;text-align:center"><strong>KHÔNG KHỞI TẠO ĐƯỢC GAME</strong><p id="load-error" style="font-weight:400;line-height:1.5"></p><p style="font-weight:400">Hãy chạy bằng npm run dev thay vì mở file index.html trực tiếp.</p></div>`;
    document.getElementById('load-error')!.textContent = message;
  }

  showPause(): void {
    this.title.innerHTML = 'TẠM <span>DỪNG</span>';
    this.message.textContent = 'Độ cao đã đạt vẫn được giữ nguyên. Bạn sẽ tiếp tục chơi đúng tại vị trí đang đứng.';
    this.play.innerHTML = 'TIẾP TỤC LEO <span>↗</span>';
    this.reset.hidden = false;
    this.screen.classList.add('visible');
  }

  hideScreen(): void { this.screen.classList.remove('visible'); }
  isScreenVisible(): boolean { return this.screen.classList.contains('visible'); }

  setHeights(maxThisRun: number, bestEver: number, currentY: number, grounded: boolean): void {
    this.current.innerHTML = `${maxThisRun.toFixed(1)} <small>m</small>`;
    this.record.innerHTML = `${bestEver.toFixed(1)} <small>m</small>`;
    this.status.textContent = grounded
      ? `Đang đứng ở ${currentY.toFixed(1)} m · Cứ leo tiếp!`
      : `Đang ${currentY < maxThisRun - 3 ? 'rơi' : 'nhảy'} · ${currentY.toFixed(1)} m`;
  }

  showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    if (this.toastTimeout) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => this.toast.classList.remove('show'), 1900);
  }
}
