import type { MapData } from '../world/MapTypes';
import { challengeOf, writeSave, type SaveData } from './Score';

/**
 * Challenge-mode achievements. Kept forever (with records); never anything about a run in progress.
 * Built from the maps on the device, so a newly downloaded map brings its own achievements.
 */
export type AchDef = { id: string; title: string; desc: string };

/** "fast" target times (seconds from 0 m to the map's exit) unless a map defines `challengeTime` */
const FAST: Record<string, number> = { map001: 8 * 60, map002: 25 * 60 };

export class Achievements {
  /** per-run tracking (Challenge runs only) */
  private fallTotal = 0;
  private bigFall = 0;
  private maxAtHundred = -1;

  constructor(private save: SaveData, private maps: () => MapData[]) {}

  list(): AchDef[] {
    const maps = this.maps();
    const out: AchDef[] = [];
    const heights = [...new Set(maps.flatMap((m) => m.milestones))].sort((a, b) => a - b);
    for (const h of heights) out.push({ id: `h:${h}`, title: `Chạm ${h} m`, desc: `Leo tới ${h} m trong một lượt Thử thách` });
    for (const m of maps) {
      out.push({ id: `top:${m.id}`, title: `Chinh phục ${m.name}`, desc: `Tới cổng đích ${m.name} ở chế độ Thử thách` });
      const fast = (m as MapData & { challengeTime?: number }).challengeTime ?? FAST[m.id];
      if (fast) out.push({ id: `fast:${m.id}`, title: `Thần tốc – ${m.name}`, desc: `Từ 0 m tới đích ${m.name} dưới ${Math.round(fast / 60)} phút` });
    }
    if (maps[0]) out.push({ id: 'steady', title: 'Bước chân vững vàng', desc: `Chinh phục ${maps[0].name} mà không rơi lần nào quá 10 m` });
    out.push({ id: 'fall50', title: 'Cú rơi để đời', desc: 'Rơi một mạch hơn 50 m (và vẫn chơi tiếp)' });
    out.push({ id: 'comeback', title: 'Không bỏ cuộc', desc: 'Trong một lượt: rơi tổng cộng hơn 100 m rồi vẫn leo cao hơn trước đó' });
    return out;
  }

  has(id: string) { return !!challengeOf(this.save).achievements[id]; }

  private unlock(id: string): AchDef | null {
    if (this.has(id)) return null;
    const def = this.list().find((d) => d.id === id);
    if (!def) return null;
    challengeOf(this.save).achievements[id] = Date.now();
    writeSave(this.save);
    return def;
  }

  startRun() { this.fallTotal = 0; this.bigFall = 0; this.maxAtHundred = -1; }

  /** new run maximum (Challenge): height milestones, comeback */
  onHeight(runMax: number): AchDef[] {
    const got: AchDef[] = [];
    for (const m of this.maps()) for (const h of m.milestones) if (runMax >= h) { const d = this.unlock(`h:${h}`); if (d) got.push(d); }
    if (this.maxAtHundred >= 0 && runMax > this.maxAtHundred + 0.5) { const d = this.unlock('comeback'); if (d) got.push(d); }
    return got;
  }

  /** a landing after falling `drop` metres; runMax at that moment */
  onLand(drop: number, runMax: number): AchDef[] {
    const got: AchDef[] = [];
    if (drop < 3) return got;
    this.fallTotal += drop;
    this.bigFall = Math.max(this.bigFall, drop);
    if (drop > 50) { const d = this.unlock('fall50'); if (d) got.push(d); }
    if (this.fallTotal > 100 && this.maxAtHundred < 0) this.maxAtHundred = runMax;
    return got;
  }

  /** reached map `m`'s exit after `t` seconds from 0 m */
  onFinish(m: MapData, t: number, firstMapId: string): AchDef[] {
    const got: AchDef[] = [];
    const push = (d: AchDef | null) => { if (d) got.push(d); };
    push(this.unlock(`top:${m.id}`));
    const fast = (m as MapData & { challengeTime?: number }).challengeTime ?? FAST[m.id];
    if (fast && t <= fast) push(this.unlock(`fast:${m.id}`));
    if (m.id === firstMapId && this.bigFall <= 10) push(this.unlock('steady'));
    return got;
  }
}
