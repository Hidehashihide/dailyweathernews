/**
 * The night phase: one museum raids another.
 *
 * Design constraints from the concept doc, encoded here:
 *   - Only display items can be taken, never money or permanent upgrades.
 *   - Every theft leaves an indelible record on the item. Re-captioning it
 *     changes the story but not the placard.
 *   - Being robbed must not be a pure loss: the victim gets a notoriety bump,
 *     because a robbery is the best press a fake museum can get.
 *   - New museums have a grace period so a first-week player is not farmed.
 */

import { GRACE_DAYS, MAX_INVENTORY } from './content';
import { addBuzz, clampStat } from './economy';
import { guardDef } from './content';
import { mintId } from './ids';
import type { IdCounter } from './ids';
import type { Museum, StolenRecord } from './types';
import type { Rng } from './rng';

export type HeistOutcome =
  | 'stolen'
  | 'blocked'
  | 'no_target'
  | 'grace'
  | 'inventory_full'
  | 'self';

export interface HeistResult {
  outcome: HeistOutcome;
  /** Catalogue id of the item taken, when `outcome === 'stolen'`. */
  defId?: string;
  /** The caption the piece carried at the moment it was taken. */
  previousCaption?: string;
  victim: string;
  raider: string;
}

/** Whether `museum` can be raided at all on `day`. */
export function isRaidable(museum: Museum, day: number, foundedDay = 1): boolean {
  if (museum.exhibits.length === 0) return false;
  return day - foundedDay >= GRACE_DAYS;
}

export function guardBlockChance(museum: Museum, day: number): number {
  const assignment = museum.guard;
  if (!assignment) return 0;
  if (day > assignment.expiresOnDay) return 0;
  return guardDef(assignment.tier).blockChance;
}

/**
 * Attempt one theft. Mutates both museums on success.
 * `foundedDay` is the victim's founding day, used for the grace period.
 */
export function attemptHeist(
  raider: Museum,
  victim: Museum,
  rng: Rng,
  day: number,
  idCounter: IdCounter,
  victimFoundedDay = 1,
): HeistResult {
  const base: Pick<HeistResult, 'victim' | 'raider'> = { victim: victim.name, raider: raider.name };

  if (raider.id === victim.id) return { outcome: 'self', ...base };
  if (victim.exhibits.length === 0) return { outcome: 'no_target', ...base };
  if (!isRaidable(victim, day, victimFoundedDay)) return { outcome: 'grace', ...base };
  if (raider.inventory.length >= MAX_INVENTORY) return { outcome: 'inventory_full', ...base };

  // Draw the guard roll unconditionally and compare, rather than calling
  // rng.chance() -- chance() short-circuits on p <= 0 without consuming
  // entropy, which would make an unguarded museum advance the stream by one
  // fewer step than a guarded one. Keeping the draw count independent of game
  // state is what lets a balance run be compared across configurations.
  const guardRoll = rng.next();
  const blocked = guardRoll < guardBlockChance(victim, day);

  // Thieves go for the flashiest piece, not a uniformly random one.
  const index = rng.pickWeighted(
    victim.exhibits.map((_, i) => i),
    (i) => {
      const exhibit = victim.exhibits[i];
      return exhibit ? 1 + exhibit.score.tipMultiplier * 2 : 1;
    },
  );
  const target = victim.exhibits[index];
  if (!target) return { outcome: 'no_target', ...base };

  if (blocked) {
    // A repelled break-in is still a story worth telling.
    addBuzz(victim, 2);
    return { outcome: 'blocked', ...base };
  }

  victim.exhibits.splice(index, 1);

  const record: StolenRecord = {
    fromMuseum: victim.name,
    onDay: day,
    previousCaption: target.caption,
  };
  const history = [...target.stolenHistory, record];

  // `genuine` is optional on JunkItem and the save validator only writes it
  // when true, so writing an explicit `false` here would make a save/load
  // round-trip produce a structurally different state.
  raider.inventory.push({
    id: mintId(idCounter, 'junk'),
    defId: target.defId,
    foundDay: day,
    stolenHistory: history,
    ...(target.genuine ? { genuine: true as const } : {}),
  });

  // Notoriety: the victim's empty plinth draws a crowd tomorrow.
  addBuzz(victim, 6 + Math.min(10, Math.round(target.score.tipMultiplier * 3)));
  victim.fame = clampStat(victim.fame + 1);

  return {
    outcome: 'stolen',
    defId: target.defId,
    previousCaption: target.caption,
    ...base,
  };
}
