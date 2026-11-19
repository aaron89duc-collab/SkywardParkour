import type { Quality } from '../config';

export type SaveData = {
  personalBest: number;
  highestMap: string | null;
  character: 'male' | 'female';
  totalPlayTime: number;
  completions: number;
  bestTime: number | null; // seconds to reach the Map 001 exit
  bestTimes?: Record<string, number>; // per map: seconds from the run start to that map's exit
  tips?: number; // how many times the hang tutorial was shown
  settings: { volume: number; quality: Quality | null; sensitivity: number; showFps: boolean; autoCam: boolean | null };
};

const KEY = 'skyward-parkour.save.v1';

const DEFAULTS: SaveData = {
  personalBest: 0,
  highestMap: null,
  character: 'male',
  totalPlayTime: 0,
  completions: 0,
  bestTime: null,
  settings: { volume: 0.7, quality: null, sensitivity: 1, showFps: false, autoCam: null },
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const d = JSON.parse(raw);
    return { ...structuredClone(DEFAULTS), ...d, settings: { ...DEFAULTS.settings, ...(d.settings ?? {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function writeSave(s: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Height-based scoring: score = highest altitude ever reached; falling never lowers it. */
export class Score {
  current = 0;
  runMax = 0;
  playTime = 0;
  newRecord = false;
  private lastSave = 0;

  constructor(public save: SaveData) {}

  get personalBest() { return this.save.personalBest; }

  private runStartBest = 0;

  resetRun() {
    this.current = 0;
    this.runMax = 0;
    this.playTime = 0;
    this.newRecord = false;
    this.runStartBest = this.save.personalBest;
  }

  /** returns true the first time the previous personal best is beaten in this run */
  update(dt: number, height: number): boolean {
    this.playTime += dt;
    this.save.totalPlayTime += dt;
    this.current = Math.max(0, height);
    if (this.current > this.runMax) this.runMax = this.current;
    let beat = false;
    if (!this.newRecord && this.runStartBest > 2 && this.runMax > this.runStartBest + 0.5) { this.newRecord = true; beat = true; }
    if (this.runMax > this.save.personalBest) this.save.personalBest = this.runMax;
    this.lastSave += dt;
    if (this.lastSave > 5) { this.lastSave = 0; writeSave(this.save); }
    return beat;
  }

  flush() { writeSave(this.save); }
}
