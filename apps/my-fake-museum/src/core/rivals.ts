/**
 * Rival museums.
 *
 * The shipping build is offline-first, so the "other curators" are simulated
 * locally. They forage, write captions from templates, upgrade cases and raid
 * at night, which gives the player something to steal from and be stolen by
 * without requiring a server on day one.
 */

import { CASES, GUARDS, JUNK, RIVAL_NAMES, caseDef, junkDefOrFallback } from './content';
import { STARTING_SLOTS, MAX_INVENTORY, MAX_SLOTS } from './content';
import { scoreCaption } from './caption';
import { addMoney, spend } from './economy';
import { mintId } from './ids';
import type { IdCounter } from './ids';
import type { Exhibit, JunkItem, RivalMuseum } from './types';
import type { Rng } from './rng';

const PLACE_WORDS = ['北方', '旧市街', '河口', '砂丘', '炭鉱跡', '旧校舎', '干潟', '峠', '灯台下'];
const PERSON_WORDS = ['初代館長', '無名の旅人', '前の持ち主', 'ある郵便配達員', '名の知れぬ学者'];
const STUDY_WORDS = ['調査', '鑑定', '照合', '年代測定', '検証'];
const NOTE_WORDS = ['返却不要', 'これで最後', '見なかったことに', '価値は問うな', '触れるな'];

const TEMPLATES: readonly string[] = [
  '{year}年、{place}の遺構より出土。用途は不明であり、{study}が継続中である。',
  '{person}が晩年まで手放さなかったとされる一点。真贋については諸説ある。',
  'これは{name}である。それ以上のことは、誰にもわからない。',
  '{place}の旧家より寄贈。付属の文書には「{note}」とのみ記されていた。',
  '当館が最も誇る{name}。理由を問われても答えられない。',
  '{year}年の{place}大火を唯一生き延びた{name}。奇跡と呼ぶほかない。',
  '世界最古の{name}。少なくとも当館はそう主張している。',
];

/** Fill one template deterministically. */
export function generateRivalCaption(defId: string, rng: Rng, skill: number): string {
  const def = junkDefOrFallback(defId);
  // Low-skill curators pick from the blunt end of the template list.
  const pool = skill >= 0.6 ? TEMPLATES : TEMPLATES.slice(2);
  const template = rng.pick(pool);
  return template
    .replace('{year}', String(rng.intInclusive(1600, 1980)))
    .replace('{place}', rng.pick(PLACE_WORDS))
    .replace('{person}', rng.pick(PERSON_WORDS))
    .replace('{study}', rng.pick(STUDY_WORDS))
    .replace('{note}', rng.pick(NOTE_WORDS))
    .replace(/\{name\}/gu, def.name);
}

export function createRival(index: number, rng: Rng, idCounter: IdCounter): RivalMuseum {
  const name = RIVAL_NAMES[index % RIVAL_NAMES.length] ?? `館 ${index + 1}`;
  return {
    id: mintId(idCounter, 'rival'),
    name,
    foundedDay: 1,
    money: rng.intInclusive(150, 400),
    authority: rng.intInclusive(0, 12),
    buzz: rng.intInclusive(0, 12),
    fame: 0,
    slots: STARTING_SLOTS,
    exhibits: [],
    inventory: [],
    guard: null,
    foragesLeft: 0,
    heistsLeft: 0,
    aggression: rng.float(0.25, 0.85),
    skill: rng.float(0.3, 0.95),
  };
}

function forage(rival: RivalMuseum, rng: Rng, day: number, idCounter: IdCounter): void {
  const picks = rng.intInclusive(1, 3);
  for (let i = 0; i < picks; i++) {
    if (rival.inventory.length >= MAX_INVENTORY) return;
    const def = rng.pickWeighted(JUNK, (j) => j.weight);
    const item: JunkItem = { id: mintId(idCounter, 'junk'), defId: def.id, foundDay: day };
    rival.inventory.push(item);
  }
}

function placeExhibits(rival: RivalMuseum, rng: Rng, day: number, idCounter: IdCounter): void {
  while (rival.exhibits.length < rival.slots && rival.inventory.length > 0) {
    const item = rival.inventory.shift();
    if (!item) break;
    const caption = generateRivalCaption(item.defId, rng, rival.skill);
    const exhibit: Exhibit = {
      id: mintId(idCounter, 'ex'),
      defId: item.defId,
      caption,
      score: scoreCaption(caption, item.defId),
      placedDay: day,
      caseTier: 'none',
      lighting: 0,
      stolenHistory: item.stolenHistory ? [...item.stolenHistory] : [],
      votesReal: 0,
      votesFake: 0,
      tipsEarned: 0,
      genuine: item.genuine === true,
    };
    rival.exhibits.push(exhibit);
  }
}

function upgrade(rival: RivalMuseum, rng: Rng, day: number): void {
  // Guards first when the museum has something worth guarding.
  if ((!rival.guard || rival.guard.expiresOnDay < day) && rival.exhibits.length >= 2) {
    const affordable = GUARDS.filter((g) => g.tier !== 'none' && g.price <= rival.money);
    const choice = affordable[affordable.length - 1];
    if (choice && rng.chance(0.5 + rival.skill * 0.3) && spend(rival, choice.price)) {
      rival.guard = { tier: choice.tier, expiresOnDay: day + choice.days };
    }
  }

  // Then a case for the best uncased piece.
  if (rng.chance(0.35 + rival.skill * 0.3)) {
    const uncased = rival.exhibits
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.caseTier === 'none');
    const best = uncased.sort((a, b) => b.e.score.tipMultiplier - a.e.score.tipMultiplier)[0];
    if (best) {
      const affordable = CASES.filter((c) => c.tier !== 'none' && c.price <= rival.money);
      const choice = affordable[affordable.length - 1];
      if (choice && spend(rival, choice.price)) {
        best.e.caseTier = choice.tier;
      }
    }
  }

  // Occasionally buy a slot.
  if (rival.slots < MAX_SLOTS && rival.money > 900 && rng.chance(0.2)) {
    if (spend(rival, 400)) rival.slots += 1;
  }
}

/** One rival's daytime turn. Heists are run separately by the reducer. */
export function runRivalDay(
  rival: RivalMuseum,
  rng: Rng,
  day: number,
  idCounter: IdCounter,
): void {
  forage(rival, rng, day, idCounter);
  placeExhibits(rival, rng, day, idCounter);
  upgrade(rival, rng, day);
  // A small stipend keeps a robbed-blind rival from stalling out forever.
  if (rival.money < 60) addMoney(rival, 40);
}

/** Display helper: the case a rival exhibit is shown in. */
export function rivalCaseName(rival: RivalMuseum, exhibitIndex: number): string {
  const exhibit = rival.exhibits[exhibitIndex];
  return exhibit ? caseDef(exhibit.caseTier).name : '';
}
