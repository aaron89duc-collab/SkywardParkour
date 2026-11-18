import './style.css';
import { Game } from './core/Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
try {
  const game = new Game(canvas);
  game.init().catch((error: unknown) => {
    console.error('Game initialization failed:', error);
    document.getElementById('loading')!.textContent = `Không thể tải game: ${error instanceof Error ? error.message : String(error)}`;
  });
} catch (error: unknown) {
  console.error('WebGL not supported or game failed:', error);
  document.getElementById('loading')!.textContent = 'Trình duyệt không hỗ trợ WebGL hoặc khởi tạo thất bại. Hãy thử Chrome/Edge mới nhất.';
}
