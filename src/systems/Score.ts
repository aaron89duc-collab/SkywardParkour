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
  slipTips?: number; // how many times the "pull back to save a misstep" tip was shown
  /** optional pickups collected (device ids, map-qualified: map003:gem1) */
  collected?: string[];
  /** plates / plate puzzles latched for good (map-qualified: map007:puzzle5), app 5 */
  latched?: string[];
  /** player name + device identity for the online leaderboard (made on the device, no account needed) */
  profile?: { name: string; id: string; token: string; tag?: string };
  /** signature of the results last accepted by the leaderboard server (resubmit when they improve) */
  lbSent?: string;
  /** last mode picked in the menu */
  mode?: GameMode;
  /** Challenge mode: only records and achievements are kept (never a position or a run in progress) */
  challenge?: ChallengeRecords;
  settings: { volume: number; quality: Quality | null; sensitivity: number; showFps: boolean; autoCam: boolean | null; music?: number };
};

/** Adventure: as before (continue from conquered maps). Challenge: every run from 0 m, falls must be re-climbed. */
export type GameMode = 'adventure' | 'challenge';

export type ChallengeRecords = {
  best: number;
  /** per map: seconds from 0 m to that map's exit */
  bestTimes: Record<string, number>;
  runs: number;
  /** achievement id -> unlock time */
  achievements: Record<string, number>;
};

export function challengeOf(s: SaveData): ChallengeRecords {
  if (!s.challenge) s.challenge = { best: 0, bestTimes: {}, runs: 0, achievements: {} };
  return s.challenge;
}

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
  /** admin test run (fly mode used): nothing is recorded */
  test = false;
  private lastSave = 0;

  /** mode of the current run: records go to Adventure (personalBest) or Challenge (save.challenge) */
  mode: GameMode = 'adventure';

  constructor(public save: SaveData) {}

  get personalBest() { return this.save.personalBest; }
  /** best height of the current mode */
  get best() { return this.mode === 'challenge' ? challengeOf(this.save).best : this.save.personalBest; }
  private setBest(v: number) { if (this.mode === 'challenge') challengeOf(this.save).best = v; else this.save.personalBest = v; }

  private runStartBest = 0;

  resetRun() {
    this.current = 0;
    this.runMax = 0;
    this.playTime = 0;
    this.newRecord = false;
    this.test = false;
    this.runStartBest = this.best;
  }

  /** returns true the first time the previous personal best is beaten in this run */
  update(dt: number, height: number): boolean {
    this.playTime += dt;
    this.current = Math.max(0, height);
    if (this.current > this.runMax) this.runMax = this.current;
    if (this.test) return false;
    this.save.totalPlayTime += dt;
    let beat = false;
    if (!this.newRecord && this.runStartBest > 2 && this.runMax > this.runStartBest + 0.5) { this.newRecord = true; beat = true; }
    if (this.runMax > this.best) this.setBest(this.runMax);
    this.lastSave += dt;
    if (this.lastSave > 5) { this.lastSave = 0; writeSave(this.save); }
    return beat;
  }

  flush() { writeSave(this.save); }
}
