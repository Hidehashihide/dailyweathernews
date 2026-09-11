/**
 * DOM layer.
 *
 * Deliberately framework-free: the whole screen is re-rendered from the view
 * model on every state change. At this scale that is both fast enough and far
 * easier to reason about than incremental updates, and it removes a whole class
 * of "stale DOM" bugs.
 *
 * Two rules hold everywhere below:
 *   1. Player text reaches the DOM only through textContent, never innerHTML.
 *   2. Every action goes through `dispatch`, which is the only place that
 *      touches game state or triggers a save.
 */

import { apply, createGame } from '../core/game';
import type { Action } from '../core/game';
import { MAX_CAPTION_GRAPHEMES } from '../core/moderation';
import { graphemeLength } from '../core/text';
import { loadGame, serialize } from '../core/save';
import { SaveStore } from '../platform/storage';
import type { GameState } from '../core/types';
import {
  exhibitViews,
  guardOptions,
  headerView,
  itemViews,
  lastReport,
  recentLog,
  rivalViews,
  standingsView,
} from './render';

type Tab = 'museum' | 'store' | 'town' | 'log';

const store = new SaveStore();

let state: GameState = createGame(String(Date.now()));
let tab: Tab = 'museum';
let toast: { text: string; ok: boolean } | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** Item id the player is currently writing a caption for. */
let composing: { itemId: string; draft: string } | null = null;
let editingExhibit: { exhibitId: string; draft: string } | null = null;
let saveError: string | null = null;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, className = 'btn', disabled = false): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function showToast(text: string, ok: boolean): void {
  toast = { text, ok };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast = null;
    render();
  }, 2600);
}

let savePending = false;
async function persist(): Promise<void> {
  if (savePending) return;
  savePending = true;
  try {
    await store.save(serialize(state));
    saveError = null;
  } catch (error) {
    saveError = (error as Error).message;
  } finally {
    savePending = false;
  }
}

function dispatch(action: Action, options: { quiet?: boolean } = {}): boolean {
  const result = apply(state, action);
  state = result.state;
  if (!options.quiet || !result.ok) showToast(result.message, result.ok);
  void persist();
  render();
  return result.ok;
}

// ---------------------------------------------------------------------------
// screens
// ---------------------------------------------------------------------------

function renderHeader(): HTMLElement {
  const h = headerView(state);
  const bar = el('header', 'topbar');

  const left = el('div', 'topbar-left');
  left.append(el('div', 'day', `${h.day}日目`), el('div', 'phase', h.phaseLabel));
  bar.append(left);

  const stats = el('div', 'stats');
  const stat = (label: string, value: string, cls = ''): HTMLElement => {
    const s = el('div', `stat ${cls}`.trim());
    s.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
    return s;
  };
  stats.append(
    stat('所持金', String(h.money), 'money'),
    stat('権威', String(h.authority)),
    stat('話題', String(h.buzz)),
    stat('名声', String(h.fame)),
    stat('展示', `${h.slotsUsed}/${h.slots}`),
    stat('警備', h.guardLabel),
  );
  bar.append(stats);
  return bar;
}

function renderTabs(): HTMLElement {
  const nav = el('nav', 'tabs');
  const entries: [Tab, string][] = [
    ['museum', '博物館'],
    ['store', '倉庫'],
    ['town', '街'],
    ['log', '記録'],
  ];
  for (const [id, label] of entries) {
    const b = button(
      label,
      () => {
        tab = id;
        render();
      },
      `tab ${tab === id ? 'tab-active' : ''}`.trim(),
    );
    b.setAttribute('aria-current', tab === id ? 'page' : 'false');
    nav.append(b);
  }
  return nav;
}

function captionEditor(
  initial: string,
  onSubmit: (text: string) => void,
  onCancel: () => void,
  submitLabel: string,
): HTMLElement {
  const box = el('div', 'editor');

  const area = el('textarea', 'caption-input');
  area.value = initial;
  area.rows = 3;
  area.maxLength = MAX_CAPTION_GRAPHEMES * 4; // generous; real limit is graphemes
  area.placeholder = '例: 1847年、旧市街の遺構より出土。用途は不明である。';
  area.setAttribute('aria-label', 'キャプション');

  const counter = el('div', 'counter');
  const updateCounter = (): void => {
    const n = graphemeLength(area.value);
    counter.textContent = `${n} / ${MAX_CAPTION_GRAPHEMES}`;
    counter.classList.toggle('over', n > MAX_CAPTION_GRAPHEMES);
  };
  updateCounter();
  area.addEventListener('input', updateCounter);
  // Ctrl/Cmd+Enter submits, matching what people expect from a text box.
  area.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      onSubmit(area.value);
    }
    if (event.key === 'Escape') onCancel();
  });

  const row = el('div', 'editor-actions');
  row.append(
    button(submitLabel, () => onSubmit(area.value), 'btn btn-primary'),
    button('やめる', onCancel, 'btn btn-ghost'),
  );

  box.append(area, counter, row);
  queueMicrotask(() => area.focus());
  return box;
}

function renderMuseum(): HTMLElement {
  const h = headerView(state);
  const wrap = el('section', 'panel');

  const actions = el('div', 'actions');
  if (state.phase === 'morning') {
    actions.append(
      button(
        `採集する（残り${h.foragesLeft}）`,
        () => dispatch({ type: 'forage' }),
        'btn btn-primary',
        h.foragesLeft <= 0,
      ),
      button('開館する', () => dispatch({ type: 'openMuseum' }), 'btn'),
    );
    if (h.relicClaimable && h.relicName) {
      actions.append(
        button(`本物の${h.relicName}を探す`, () => dispatch({ type: 'claimRelic' }), 'btn btn-relic'),
      );
    }
  } else if (state.phase === 'night') {
    actions.append(
      button('夜を終える', () => dispatch({ type: 'endNight' }), 'btn btn-primary'),
      button('街を見る', () => {
        tab = 'town';
        render();
      }, 'btn'),
    );
  }
  wrap.append(actions);

  const report = lastReport(state);
  if (report && report.day === state.day && state.phase === 'night') {
    const card = el('div', 'report');
    card.append(
      el('h3', '', `${report.day}日目の記録`),
      el(
        'p',
        '',
        `来館 ${report.visitors} 人 / チップ ${report.tips} / ` +
          `本物 ${report.votesReal} ・ 嘘くさい ${report.votesFake}`,
      ),
    );
    wrap.append(card);
  }

  const exhibits = exhibitViews(state);
  if (exhibits.length === 0) {
    wrap.append(el('p', 'empty', 'まだ何も展示していない。倉庫から選んで説明を書こう。'));
  }

  const grid = el('div', 'grid');
  for (const e of exhibits) {
    const card = el('article', 'card');
    const head = el('div', 'card-head');
    head.append(el('span', 'emoji', e.emoji), el('span', 'card-name', e.name));
    if (e.genuine) head.append(el('span', 'tag tag-genuine', '本物'));
    card.append(head);

    // Player-written text: textContent only.
    card.append(el('p', 'caption', e.caption));

    if (e.stolenFrom.length > 0) {
      const placard = el('div', 'placard');
      placard.append(el('span', 'placard-label', '盗品'));
      placard.append(el('span', '', e.stolenFrom.join(' → ') + ' より'));
      card.append(placard);
    }

    const meta = el('div', 'meta');
    meta.append(
      el('span', 'chip', `権威 ${e.plausibility}`),
      el('span', 'chip', `話題 ${e.absurdity}`),
      el('span', 'chip chip-tip', `×${e.tipMultiplier.toFixed(2)}`),
      el('span', 'chip', `${e.caseName}`),
      el('span', 'chip', `照明 ${e.lighting}`),
    );
    card.append(meta);

    const votes = el('div', 'votes');
    votes.append(
      el('span', '', `本物 ${e.votesReal}`),
      el('span', '', `嘘くさい ${e.votesFake}`),
      el('span', '', `累計 ${e.tipsEarned}`),
    );
    card.append(votes);

    if (state.phase === 'morning') {
      if (editingExhibit?.exhibitId === e.id) {
        card.append(
          captionEditor(
            editingExhibit.draft,
            (text) => {
              if (dispatch({ type: 'recaption', exhibitId: e.id, caption: text })) {
                editingExhibit = null;
                render();
              }
            },
            () => {
              editingExhibit = null;
              render();
            },
            '書き換える',
          ),
        );
      } else {
        const row = el('div', 'card-actions');
        row.append(
          button('由来を書き換える', () => {
            editingExhibit = { exhibitId: e.id, draft: e.caption };
            render();
          }),
          button('下げる', () => dispatch({ type: 'withdraw', exhibitId: e.id }), 'btn btn-ghost'),
        );
        if (e.nextCaseTier && e.nextCasePrice !== null) {
          row.append(
            button(
              `ケース +${e.nextCasePrice}`,
              () => dispatch({ type: 'buyCase', exhibitId: e.id, tier: e.nextCaseTier as never }),
              'btn',
              state.player.money < e.nextCasePrice,
            ),
          );
        }
        if (e.nextLightingPrice !== null) {
          row.append(
            button(
              `照明 +${e.nextLightingPrice}`,
              () => dispatch({ type: 'buyLighting', exhibitId: e.id }),
              'btn',
              state.player.money < e.nextLightingPrice,
            ),
          );
        }
        card.append(row);
      }
    }
    grid.append(card);
  }
  wrap.append(grid);

  if (state.phase === 'morning' && h.nextSlotPrice !== null) {
    wrap.append(
      button(
        `展示枠を増やす（${h.nextSlotPrice}）`,
        () => dispatch({ type: 'buySlot' }),
        'btn btn-wide',
        state.player.money < h.nextSlotPrice,
      ),
    );
  }

  const guards = el('div', 'guards');
  if (state.phase === 'morning') {
    guards.append(el('h3', '', '警備を雇う'));
    const row = el('div', 'card-actions');
    for (const g of guardOptions(state)) {
      row.append(
        button(
          `${g.name} ${g.price}`,
          () => dispatch({ type: 'buyGuard', tier: g.tier as never }),
          'btn',
          !g.affordable,
        ),
      );
    }
    guards.append(row);
    wrap.append(guards);
  }

  return wrap;
}

function renderStore(): HTMLElement {
  const wrap = el('section', 'panel');
  const items = itemViews(state);
  wrap.append(el('h2', '', `倉庫（${items.length} / 24）`));

  if (items.length === 0) {
    wrap.append(el('p', 'empty', '倉庫は空だ。朝のうちに歩き回って拾ってこよう。'));
    return wrap;
  }

  const grid = el('div', 'grid');
  for (const item of items) {
    const card = el('article', 'card');
    const head = el('div', 'card-head');
    head.append(el('span', 'emoji', item.emoji), el('span', 'card-name', item.name));
    if (item.genuine) head.append(el('span', 'tag tag-genuine', '本物'));
    card.append(head);
    card.append(el('div', 'rarity', item.rarity));

    if (item.stolenFrom.length > 0) {
      const placard = el('div', 'placard');
      placard.append(el('span', 'placard-label', '盗品'));
      placard.append(el('span', '', item.stolenFrom.join(' → ') + ' より'));
      card.append(placard);
    }

    if (state.phase === 'morning') {
      if (composing?.itemId === item.id) {
        card.append(
          captionEditor(
            composing.draft,
            (text) => {
              if (dispatch({ type: 'place', itemId: item.id, caption: text })) {
                composing = null;
                tab = 'museum';
                render();
              }
            },
            () => {
              composing = null;
              render();
            },
            '展示する',
          ),
        );
      } else {
        const row = el('div', 'card-actions');
        row.append(
          button(
            '説明を書いて展示',
            () => {
              composing = { itemId: item.id, draft: '' };
              render();
            },
            'btn btn-primary',
            state.player.exhibits.length >= state.player.slots,
          ),
          button('捨てる', () => dispatch({ type: 'discard', itemId: item.id }), 'btn btn-ghost'),
        );
        card.append(row);
      }
    }
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

function renderTown(): HTMLElement {
  const wrap = el('section', 'panel');
  wrap.append(el('h2', '', '街の博物館'));

  if (state.phase !== 'night') {
    wrap.append(el('p', 'empty', '略奪ができるのは夜だけだ。'));
  }

  const grid = el('div', 'grid');
  for (const r of rivalViews(state)) {
    const card = el('article', 'card');
    card.append(el('div', 'card-head', r.name));
    card.append(el('div', 'rarity', `展示 ${r.exhibitCount} 点 / ${r.guardName ?? '無警備'}`));
    if (r.topCaption) card.append(el('p', 'caption caption-muted', r.topCaption));
    if (state.phase === 'night') {
      card.append(
        button(
          '忍び込む',
          () => dispatch({ type: 'raid', rivalId: r.id }),
          'btn btn-primary',
          !r.raidable || state.player.heistsLeft <= 0,
        ),
      );
    }
    grid.append(card);
  }
  wrap.append(grid);

  const table = el('div', 'standings');
  table.append(el('h3', '', '博物館協会ランキング'));
  for (const row of standingsView(state)) {
    const line = el('div', `standing ${row.isPlayer ? 'standing-you' : ''}`.trim());
    line.append(el('span', '', row.name), el('span', '', String(row.score)));
    table.append(line);
  }
  wrap.append(table);
  return wrap;
}

function renderLog(): HTMLElement {
  const wrap = el('section', 'panel');
  wrap.append(el('h2', '', '記録'));
  const list = el('div', 'log');
  for (const entry of recentLog(state)) {
    const line = el('div', `log-line log-${entry.kind}`);
    line.append(el('span', 'log-day', `${entry.day}日`), el('span', '', entry.text));
    list.append(line);
  }
  wrap.append(list);

  const totals = el('div', 'totals');
  totals.append(
    el('h3', '', '通算'),
    el('p', '', `チップ ${state.totals.tips} / 来館 ${state.totals.visitors}`),
    el('p', '', `展示 ${state.totals.exhibitsPlaced} 点 / 盗んだ ${state.totals.itemsStolen} / 盗まれた ${state.totals.itemsLost}`),
    el('p', 'muted', `保存先: ${store.backendName}`),
  );
  wrap.append(totals);

  const danger = el('div', 'card-actions');
  danger.append(
    button(
      'はじめからやり直す',
      () => {
        if (!window.confirm('この博物館の記録はすべて消えます。よろしいですか？')) return;
        state = createGame(String(Date.now()));
        composing = null;
        editingExhibit = null;
        tab = 'museum';
        void persist();
        showToast('新しい博物館を開いた。', true);
        render();
      },
      'btn btn-danger',
    ),
  );
  wrap.append(danger);
  return wrap;
}

// ---------------------------------------------------------------------------
// root
// ---------------------------------------------------------------------------

function render(): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.textContent = '';

  root.append(renderHeader(), renderTabs());

  switch (tab) {
    case 'museum':
      root.append(renderMuseum());
      break;
    case 'store':
      root.append(renderStore());
      break;
    case 'town':
      root.append(renderTown());
      break;
    case 'log':
      root.append(renderLog());
      break;
  }

  if (saveError) {
    const warn = el('div', 'banner banner-error', `保存できていません: ${saveError}`);
    root.append(warn);
  }
  if (toast) {
    const t = el('div', `toast ${toast.ok ? 'toast-ok' : 'toast-bad'}`, toast.text);
    t.setAttribute('role', 'status');
    root.append(t);
  }
}

export async function boot(): Promise<void> {
  const saved = await store.loadRaw();
  if (saved) {
    const result = loadGame(saved.json);
    if (result.ok) {
      state = result.state;
      if (saved.slot === 'backup') {
        showToast('バックアップから復元しました。', true);
      } else if (result.repairs.length > 0) {
        showToast(`セーブを修復しました（${result.repairs.length}件）`, true);
      }
    } else {
      // Keep the unreadable file in place rather than overwriting it; the
      // player may be able to recover it manually.
      showToast(`セーブを読めませんでした: ${result.error}`, false);
    }
  }
  render();
}
