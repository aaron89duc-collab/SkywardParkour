import './ui/style.css';
import { Game } from './core/Game';

const app = document.getElementById('app')!;
const game = new Game(app);
game.init().catch((err) => {
  console.error(err);
  game.ui?.showError('Không thể tải game: ' + (err?.message ?? err) + '. Hãy tải lại trang.');
});
