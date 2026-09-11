/**
 * Money and stat arithmetic.
 *
 * Every mutation of a numeric museum field goes through here. Doing it in one
 * place is what keeps `money` from drifting to -0, 1e21, or NaN after a few
 * hundred simulated days -- all three of which are reachable if callers do
 * `museum.money += x` by hand.
 */

import type { Museum } from './types';

/** Above this, further gains are clamped. Keeps numbers printable and safe. */
export const MAX_MONEY = 9_999_999;
export const MAX_STAT = 99_999;

/** Coerce anything to a finite, non-negative integer. */
export function safeInt(value: number, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded;
}

export function clampMoney(value: number): number {
  return Math.min(safeInt(value), MAX_MONEY);
}

export function clampStat(value: number): number {
  return Math.min(safeInt(value), MAX_STAT);
}

/** Add (or subtract) money. Never goes below zero. Returns the new balance. */
export function addMoney(museum: Museum, delta: number): number {
  const d = Number.isFinite(delta) ? Math.round(delta) : 0;
  museum.money = clampMoney(museum.money + d);
  return museum.money;
}

export function canAfford(museum: Museum, cost: number): boolean {
  const c = safeInt(cost);
  return museum.money >= c;
}

/**
 * Deduct `cost` if affordable. Returns true on success, false without
 * mutating anything on failure -- callers rely on this to stay atomic.
 */
export function spend(museum: Museum, cost: number): boolean {
  const c = safeInt(cost);
  if (museum.money < c) return false;
  museum.money = clampMoney(museum.money - c);
  return true;
}

export function addAuthority(museum: Museum, delta: number): number {
  const d = Number.isFinite(delta) ? Math.round(delta) : 0;
  museum.authority = clampStat(museum.authority + d);
  return museum.authority;
}

export function addBuzz(museum: Museum, delta: number): number {
  const d = Number.isFinite(delta) ? Math.round(delta) : 0;
  museum.buzz = clampStat(museum.buzz + d);
  return museum.buzz;
}

export function addFame(museum: Museum, delta: number): number {
  const d = Number.isFinite(delta) ? Math.round(delta) : 0;
  museum.fame = clampStat(museum.fame + d);
  return museum.fame;
}

/**
 * Buzz is attention, and attention decays. Without this the endgame is a
 * runaway: buzz -> visitors -> buzz.
 */
export function decayBuzz(museum: Museum, rate = 0.12): void {
  const kept = museum.buzz * (1 - rate);
  museum.buzz = clampStat(Math.floor(kept));
}
