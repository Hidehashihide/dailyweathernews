/**
 * Deterministic id generation.
 *
 * Ids must be stable across save/load and unique for the lifetime of a save,
 * so they are derived from a monotonic counter held in game state -- never
 * from Date.now() or Math.random().
 */

export interface IdCounter {
  next: number;
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function base36(n: number): string {
  if (n === 0) return '0';
  let out = '';
  let v = n;
  while (v > 0) {
    out = (ALPHABET[v % 36] as string) + out;
    v = Math.floor(v / 36);
  }
  return out;
}

/** Mints `prefix_<base36>`; mutates the counter. */
export function mintId(counter: IdCounter, prefix: string): string {
  if (!Number.isSafeInteger(counter.next) || counter.next < 0) {
    throw new RangeError(`mintId: corrupt counter (${counter.next})`);
  }
  const id = `${prefix}_${base36(counter.next)}`;
  counter.next += 1;
  return id;
}
