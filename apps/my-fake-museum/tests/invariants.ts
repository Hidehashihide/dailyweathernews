/**
 * Shared invariant checker.
 *
 * Everything that must be true of a GameState at rest lives here, so the unit
 * suite and the long soak run assert exactly the same rules.
 * Returns a list of violation strings; empty means healthy.
 */

import { MAX_MONEY, MAX_STAT } from '../src/core/economy';
import {
  MAX_INVENTORY,
  MAX_LIGHTING,
  MAX_LOG,
  MAX_REPORTS,
  MAX_SLOTS,
  STARTING_SLOTS,
} from '../src/core/content';
import { MAX_TIP_MULTIPLIER, MIN_TIP_MULTIPLIER } from '../src/core/caption';
import type { GameState, Museum } from '../src/core/types';

const PHASES = new Set(['morning', 'open', 'night', 'settlement']);

function checkMuseum(m: Museum, label: string, day: number, out: string[]): void {
  const int = (name: string, value: number, max: number): void => {
    if (!Number.isSafeInteger(value)) out.push(`${label}.${name} is not a safe integer: ${value}`);
    else if (value < 0) out.push(`${label}.${name} is negative: ${value}`);
    else if (value > max) out.push(`${label}.${name} exceeds ${max}: ${value}`);
  };

  int('money', m.money, MAX_MONEY);
  int('authority', m.authority, MAX_STAT);
  int('buzz', m.buzz, MAX_STAT);
  int('fame', m.fame, MAX_STAT);

  if (m.slots < STARTING_SLOTS || m.slots > MAX_SLOTS) {
    out.push(`${label}.slots out of range: ${m.slots}`);
  }
  if (m.exhibits.length > m.slots) {
    out.push(`${label} has ${m.exhibits.length} exhibits in ${m.slots} slots`);
  }
  if (m.inventory.length > MAX_INVENTORY) {
    out.push(`${label}.inventory overflow: ${m.inventory.length}`);
  }
  if (m.foragesLeft < 0) out.push(`${label}.foragesLeft negative`);
  if (m.heistsLeft < 0) out.push(`${label}.heistsLeft negative`);
  if (m.foundedDay < 1) out.push(`${label}.foundedDay invalid: ${m.foundedDay}`);

  if (m.guard) {
    if (m.guard.tier === 'none') out.push(`${label} holds a 'none' guard assignment`);
    if (m.guard.expiresOnDay < day) {
      out.push(`${label} holds an expired guard (expires ${m.guard.expiresOnDay}, day ${day})`);
    }
  }

  for (const e of m.exhibits) {
    if (e.lighting < 0 || e.lighting > MAX_LIGHTING) {
      out.push(`${label} exhibit ${e.id} lighting out of range: ${e.lighting}`);
    }
    const s = e.score;
    for (const key of ['plausibility', 'absurdity', 'craft', 'coherence'] as const) {
      if (!Number.isFinite(s[key]) || s[key] < 0 || s[key] > 100) {
        out.push(`${label} exhibit ${e.id} score.${key} out of range: ${s[key]}`);
      }
    }
    if (
      !Number.isFinite(s.tipMultiplier) ||
      s.tipMultiplier < MIN_TIP_MULTIPLIER ||
      s.tipMultiplier > MAX_TIP_MULTIPLIER
    ) {
      out.push(`${label} exhibit ${e.id} tipMultiplier out of range: ${s.tipMultiplier}`);
    }
    if (!Number.isSafeInteger(e.votesReal) || e.votesReal < 0) {
      out.push(`${label} exhibit ${e.id} votesReal invalid: ${e.votesReal}`);
    }
    if (!Number.isSafeInteger(e.votesFake) || e.votesFake < 0) {
      out.push(`${label} exhibit ${e.id} votesFake invalid: ${e.votesFake}`);
    }
    if (!Number.isSafeInteger(e.tipsEarned) || e.tipsEarned < 0) {
      out.push(`${label} exhibit ${e.id} tipsEarned invalid: ${e.tipsEarned}`);
    }
    for (const record of e.stolenHistory) {
      if (typeof record.fromMuseum !== 'string' || record.fromMuseum === '') {
        out.push(`${label} exhibit ${e.id} has a theft record with no source`);
      }
      if (!Number.isSafeInteger(record.onDay) || record.onDay < 1) {
        out.push(`${label} exhibit ${e.id} theft record day invalid: ${record.onDay}`);
      }
    }
  }
}

export function checkInvariants(state: GameState): string[] {
  const out: string[] = [];

  if (!Number.isSafeInteger(state.day) || state.day < 1) out.push(`day invalid: ${state.day}`);
  if (!PHASES.has(state.phase)) out.push(`phase invalid: ${state.phase}`);

  for (const [name, word] of Object.entries(state.rng)) {
    if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) {
      out.push(`rng.${name} is not a uint32: ${word}`);
    }
  }
  if ((state.rng.a | state.rng.b | state.rng.c | state.rng.d) === 0) {
    out.push('rng state is all zero (stream would be degenerate)');
  }

  if (!Number.isSafeInteger(state.idCounter.next) || state.idCounter.next < 1) {
    out.push(`idCounter invalid: ${state.idCounter.next}`);
  }
  if (state.log.length > MAX_LOG) out.push(`log overflow: ${state.log.length}`);
  if (state.reports.length > MAX_REPORTS) out.push(`reports overflow: ${state.reports.length}`);

  checkMuseum(state.player, 'player', state.day, out);
  state.rivals.forEach((r, i) => {
    checkMuseum(r, `rival[${i}]`, state.day, out);
    if (r.aggression < 0 || r.aggression > 1) out.push(`rival[${i}].aggression out of range`);
    if (r.skill < 0 || r.skill > 1) out.push(`rival[${i}].skill out of range`);
  });

  // Ids must be globally unique: a collision makes the UI edit the wrong piece.
  const seen = new Map<string, string>();
  const claim = (id: string, where: string): void => {
    const prior = seen.get(id);
    if (prior !== undefined) out.push(`duplicate id ${id} in ${prior} and ${where}`);
    else seen.set(id, where);
  };
  const walk = (m: Museum, label: string): void => {
    claim(m.id, `${label}.id`);
    m.exhibits.forEach((e) => claim(e.id, `${label}.exhibits`));
    m.inventory.forEach((i) => claim(i.id, `${label}.inventory`));
  };
  walk(state.player, 'player');
  state.rivals.forEach((r, i) => walk(r, `rival[${i}]`));

  // Every minted id must be below the counter, or the next mint collides.
  for (const [id] of seen) {
    const at = id.lastIndexOf('_');
    if (at === -1) continue;
    const ordinal = Number.parseInt(id.slice(at + 1), 36);
    if (Number.isFinite(ordinal) && ordinal >= state.idCounter.next) {
      out.push(`id ${id} is at or beyond idCounter ${state.idCounter.next}`);
    }
  }

  for (const [key, value] of Object.entries(state.totals)) {
    if (!Number.isSafeInteger(value) || value < 0) out.push(`totals.${key} invalid: ${value}`);
  }

  if (state.relic && state.relic.defId === '') out.push('relic has an empty defId');

  return out;
}
