/**
 * Save serialisation, validation and migration.
 *
 * A save file is the one artefact a player cannot re-create, so this module is
 * defensive to the point of paranoia:
 *   - Every field is re-validated on load; anything unexpected is repaired,
 *     never trusted.
 *   - `loadGame` never throws. A corrupt save returns an error, and the caller
 *     keeps the backup slot rather than wiping progress.
 *   - Migrations are explicit and additive, one version step at a time.
 */

import {
  FORAGES_PER_DAY,
  HEISTS_PER_NIGHT,
  MAX_INVENTORY,
  MAX_LOG,
  MAX_REPORTS,
  MAX_SLOTS,
  STARTING_SLOTS,
} from './content';
import { scoreCaption } from './caption';
import { clampMoney, clampStat, clampTotal, safeInt } from './economy';
import { SAVE_VERSION } from './types';
import type {
  CaseTier,
  Exhibit,
  GameState,
  GuardTier,
  JunkItem,
  Museum,
  Phase,
  RivalMuseum,
  StolenRecord,
} from './types';

export interface LoadSuccess {
  ok: true;
  state: GameState;
  /** Non-fatal repairs applied during load. Surfaced in the debug panel. */
  repairs: string[];
}

export interface LoadFailure {
  ok: false;
  error: string;
}

export type LoadResult = LoadSuccess | LoadFailure;

const CASE_TIERS: readonly CaseTier[] = ['none', 'glass', 'marble', 'gold'];
const GUARD_TIERS: readonly GuardTier[] = ['none', 'volunteer', 'pro', 'elite'];
const PHASES: readonly Phase[] = ['morning', 'open', 'night', 'settlement'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

// ---------------------------------------------------------------------------
// validation / repair
// ---------------------------------------------------------------------------

function repairStolenHistory(raw: unknown): StolenRecord[] {
  return arr(raw)
    .filter(isObject)
    .map((r) => ({
      fromMuseum: str(r['fromMuseum'], '不明な館'),
      onDay: safeInt(num(r['onDay'], 1), 1),
      previousCaption: str(r['previousCaption'], ''),
    }));
}

function repairExhibit(raw: unknown, repairs: string[]): Exhibit | null {
  if (!isObject(raw)) return null;
  const id = str(raw['id'], '');
  const defId = str(raw['defId'], '');
  if (id === '' || defId === '') {
    repairs.push('id または defId を欠いた展示品を破棄しました。');
    return null;
  }
  const caption = str(raw['caption'], '');
  // Scores are derived data: always recompute rather than trust the file.
  // A tampered save cannot grant an impossible tip multiplier this way.
  const score = scoreCaption(caption, defId);

  return {
    id,
    defId,
    caption,
    score,
    placedDay: safeInt(num(raw['placedDay'], 1), 1),
    caseTier: oneOf(raw['caseTier'], CASE_TIERS, 'none'),
    lighting: Math.max(0, Math.min(3, safeInt(num(raw['lighting'], 0)))),
    stolenHistory: repairStolenHistory(raw['stolenHistory']),
    votesReal: clampStat(num(raw['votesReal'], 0)),
    votesFake: clampStat(num(raw['votesFake'], 0)),
    tipsEarned: clampMoney(num(raw['tipsEarned'], 0)),
    genuine: raw['genuine'] === true,
  };
}

function repairItem(raw: unknown): JunkItem | null {
  if (!isObject(raw)) return null;
  const id = str(raw['id'], '');
  const defId = str(raw['defId'], '');
  if (id === '' || defId === '') return null;
  const history = repairStolenHistory(raw['stolenHistory']);
  const item: JunkItem = { id, defId, foundDay: safeInt(num(raw['foundDay'], 1), 1) };
  if (history.length > 0) item.stolenHistory = history;
  if (raw['genuine'] === true) item.genuine = true;
  return item;
}

function repairMuseum(raw: unknown, fallbackId: string, repairs: string[]): Museum {
  const src = isObject(raw) ? raw : {};
  const exhibits = arr(src['exhibits'])
    .map((e) => repairExhibit(e, repairs))
    .filter((e): e is Exhibit => e !== null);
  const allItems = arr(src['inventory'])
    .map(repairItem)
    .filter((i): i is JunkItem => i !== null);
  const inventory = allItems.slice(0, MAX_INVENTORY);
  if (allItems.length > inventory.length) {
    // Never truncate silently: a dropped item is player progress disappearing.
    repairs.push(`倉庫の上限(${MAX_INVENTORY})を超える ${allItems.length - inventory.length} 点を破棄しました。`);
  }

  const slots = Math.max(STARTING_SLOTS, Math.min(MAX_SLOTS, safeInt(num(src['slots'], STARTING_SLOTS), STARTING_SLOTS)));
  if (exhibits.length > slots) {
    repairs.push(`展示枠(${slots})を超える展示品を倉庫に戻しました。`);
    while (exhibits.length > slots) {
      const removed = exhibits.pop();
      if (removed && inventory.length < MAX_INVENTORY) {
        inventory.push({ id: removed.id, defId: removed.defId, foundDay: removed.placedDay });
      }
    }
  }

  const guardRaw = src['guard'];
  const guard = isObject(guardRaw)
    ? {
        tier: oneOf(guardRaw['tier'], GUARD_TIERS, 'none'),
        expiresOnDay: safeInt(num(guardRaw['expiresOnDay'], 0)),
      }
    : null;

  return {
    id: str(src['id'], fallbackId),
    name: str(src['name'], '無名館'),
    foundedDay: Math.max(1, safeInt(num(src['foundedDay'], 1), 1)),
    money: clampMoney(num(src['money'], 0)),
    authority: clampStat(num(src['authority'], 0)),
    buzz: clampStat(num(src['buzz'], 0)),
    fame: clampStat(num(src['fame'], 0)),
    slots,
    exhibits,
    inventory,
    guard: guard && guard.tier !== 'none' ? guard : null,
    foragesLeft: Math.max(0, Math.min(FORAGES_PER_DAY, safeInt(num(src['foragesLeft'], 0)))),
    heistsLeft: Math.max(0, Math.min(HEISTS_PER_NIGHT, safeInt(num(src['heistsLeft'], 0)))),
  };
}

function repairRival(raw: unknown, index: number, repairs: string[]): RivalMuseum {
  const src = isObject(raw) ? raw : {};
  const base = repairMuseum(src, `rival_r${index}`, repairs);
  return {
    ...base,
    aggression: Math.max(0, Math.min(1, num(src['aggression'], 0.5))),
    skill: Math.max(0, Math.min(1, num(src['skill'], 0.5))),
  };
}

// ---------------------------------------------------------------------------
// migration
// ---------------------------------------------------------------------------

/**
 * Bring an older payload up to the current shape, one step at a time.
 * Steps only add or rename; they never need the full validator, because
 * `repair*` runs afterwards regardless.
 */
function migrate(raw: Record<string, unknown>, repairs: string[]): Record<string, unknown> {
  let data = raw;
  let version = safeInt(num(data['version'], 1), 1);

  if (version < 2) {
    // v1 had no `totals` block and stored `fame` only on the player.
    data = { ...data, totals: isObject(data['totals']) ? data['totals'] : {} };
    repairs.push('v1 セーブを v2 形式に変換しました。');
    version = 2;
  }
  if (version < 3) {
    // v2 had no founding day; everything is treated as founded on day 1.
    const withFounded = (m: unknown): unknown =>
      isObject(m) ? { ...m, foundedDay: num(m['foundedDay'], 1) } : m;
    data = {
      ...data,
      player: withFounded(data['player']),
      rivals: arr(data['rivals']).map(withFounded),
    };
    repairs.push('v2 セーブを v3 形式に変換しました。');
    version = 3;
  }

  return { ...data, version };
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

export function loadGame(json: string): LoadResult {
  if (typeof json !== 'string' || json.trim() === '') {
    return { ok: false, error: 'セーブデータが空です。' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'セーブデータを読めませんでした（JSON 破損）。' };
  }
  if (!isObject(parsed)) {
    return { ok: false, error: 'セーブデータの形式が不正です。' };
  }

  const fileVersion = safeInt(num(parsed['version'], 0), 0);
  if (fileVersion > SAVE_VERSION) {
    return {
      ok: false,
      error: `新しいバージョンのセーブデータです（v${fileVersion}）。アプリを更新してください。`,
    };
  }

  const repairs: string[] = [];
  const data = migrate(parsed, repairs);

  const rngRaw = isObject(data['rng']) ? data['rng'] : {};
  const rng = {
    a: safeInt(num(rngRaw['a'], 0)) >>> 0,
    b: safeInt(num(rngRaw['b'], 0)) >>> 0,
    c: safeInt(num(rngRaw['c'], 0)) >>> 0,
    d: safeInt(num(rngRaw['d'], 0)) >>> 0,
  };
  if ((rng.a | rng.b | rng.c | rng.d) === 0) {
    rng.a = 0x9e3779b9;
    repairs.push('乱数状態が壊れていたため再初期化しました。');
  }

  const player = repairMuseum(data['player'], 'you_1', repairs);
  const rivals = arr(data['rivals']).map((r, i) => repairRival(r, i, repairs));

  const counterRaw = isObject(data['idCounter']) ? data['idCounter'] : {};
  // The counter must exceed every id already in use, or newly minted ids can
  // collide with existing ones and the UI starts editing the wrong exhibit.
  const declared = Math.max(1, safeInt(num(counterRaw['next'], 1), 1));
  const highest = highestIdOrdinal([player, ...rivals]);
  const next = Math.max(declared, highest + 1);
  if (next !== declared) {
    repairs.push('ID カウンタが古かったため繰り上げました。');
  }

  const relicRaw = data['relic'];
  const relic = isObject(relicRaw)
    ? {
        day: safeInt(num(relicRaw['day'], 0)),
        defId: str(relicRaw['defId'], ''),
        claimedBy: typeof relicRaw['claimedBy'] === 'string' ? (relicRaw['claimedBy'] as string) : null,
      }
    : null;

  const totalsRaw = isObject(data['totals']) ? data['totals'] : {};

  const state: GameState = {
    version: SAVE_VERSION,
    seed: str(data['seed'], 'recovered'),
    rng,
    idCounter: { next },
    day: Math.max(1, safeInt(num(data['day'], 1), 1)),
    phase: oneOf(data['phase'], PHASES, 'morning'),
    player,
    rivals,
    log: arr(data['log'])
      .filter(isObject)
      .map((l) => ({
        id: str(l['id'], 'log_x'),
        day: safeInt(num(l['day'], 1), 1),
        kind: str(l['kind'], 'day') as GameState['log'][number]['kind'],
        text: str(l['text'], ''),
      }))
      .slice(-MAX_LOG),
    reports: arr(data['reports'])
      .filter(isObject)
      .map((r) => ({
        day: safeInt(num(r['day'], 1), 1),
        visitors: safeInt(num(r['visitors'], 0)),
        tips: safeInt(num(r['tips'], 0)),
        authorityGained: safeInt(num(r['authorityGained'], 0)),
        buzzGained: safeInt(num(r['buzzGained'], 0)),
        votesReal: safeInt(num(r['votesReal'], 0)),
        votesFake: safeInt(num(r['votesFake'], 0)),
        robbedCount: safeInt(num(r['robbedCount'], 0)),
        stolenCount: safeInt(num(r['stolenCount'], 0)),
      }))
      .slice(-MAX_REPORTS),
    relic: relic && relic.defId !== '' ? relic : null,
    // Lifetime counters use MAX_TOTAL, not MAX_STAT: see economy.ts.
    totals: {
      tips: clampTotal(num(totalsRaw['tips'], 0)),
      visitors: clampTotal(num(totalsRaw['visitors'], 0)),
      exhibitsPlaced: clampTotal(num(totalsRaw['exhibitsPlaced'], 0)),
      itemsStolen: clampTotal(num(totalsRaw['itemsStolen'], 0)),
      itemsLost: clampTotal(num(totalsRaw['itemsLost'], 0)),
      daysPlayed: clampTotal(num(totalsRaw['daysPlayed'], 0)),
    },
    settings: {
      moderation: isObject(data['settings']) ? data['settings']['moderation'] !== false : true,
    },
  };

  if (state.rivals.length === 0) {
    repairs.push('ライバル館のデータが失われていました。');
  }

  return { ok: true, state, repairs };
}

/** Largest ordinal across every `prefix_<base36>` id currently in use. */
function highestIdOrdinal(museums: readonly Museum[]): number {
  let highest = 0;
  const consider = (id: string): void => {
    const at = id.lastIndexOf('_');
    if (at === -1) return;
    const parsed = Number.parseInt(id.slice(at + 1), 36);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  };
  for (const museum of museums) {
    consider(museum.id);
    for (const exhibit of museum.exhibits) consider(exhibit.id);
    for (const item of museum.inventory) consider(item.id);
  }
  return highest;
}
