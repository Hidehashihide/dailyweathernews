/**
 * Long soak run. Not part of the unit suite -- run it before a release.
 *
 *   npm run sim              # 2000 days x 8 seeds
 *   DAYS=10000 SEEDS=3 npm run sim
 *
 * Fails the process on the first invariant violation and prints the day and
 * seed so it can be reproduced exactly.
 */

import { createGame } from '../../src/core/game';
import { loadGame, serialize } from '../../src/core/save';
import { Rng } from '../../src/core/rng';
import { checkInvariants } from '../invariants';
import { playRandomDay } from '../driver';

const DAYS = Number(process.env['DAYS'] ?? 2000);
const SEEDS = Number(process.env['SEEDS'] ?? 8);

let failures = 0;
const started = Date.now();

for (let i = 0; i < SEEDS; i++) {
  const seed = `soak-${i}`;
  let state = createGame(seed);
  const rng = Rng.fromSeed(`driver-${seed}`);
  let peakSaveBytes = 0;

  for (let day = 0; day < DAYS; day++) {
    state = playRandomDay(state, rng);

    const violations = checkInvariants(state);
    if (violations.length > 0) {
      console.error(`\nINVARIANT FAILURE  seed=${seed} day=${state.day}`);
      for (const v of violations) console.error(`  - ${v}`);
      failures += 1;
      break;
    }

    // Exercise the save path periodically; a drift here is a data-loss bug.
    if (day % 50 === 0) {
      const json = serialize(state);
      peakSaveBytes = Math.max(peakSaveBytes, json.length);
      const result = loadGame(json);
      if (!result.ok) {
        console.error(`\nSAVE FAILURE  seed=${seed} day=${state.day}: ${result.error}`);
        failures += 1;
        break;
      }
      if (serialize(result.state) !== json) {
        console.error(`\nSAVE DRIFT  seed=${seed} day=${state.day}`);
        failures += 1;
        break;
      }
      if (result.repairs.length > 0) {
        console.error(`\nUNEXPECTED REPAIRS  seed=${seed} day=${state.day}: ${result.repairs.join(', ')}`);
        failures += 1;
        break;
      }
    }
  }

  console.log(
    `${seed}: day ${state.day}, money ${state.player.money}, ` +
      `exhibits ${state.player.exhibits.length}/${state.player.slots}, ` +
      `stolen ${state.totals.itemsStolen}, lost ${state.totals.itemsLost}, ` +
      `save ${(peakSaveBytes / 1024).toFixed(1)}KB`,
  );
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${SEEDS} seeds x ${DAYS} days in ${seconds}s -- ${failures === 0 ? 'OK' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
