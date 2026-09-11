# MY FAKE MUSEUM

> ゴミを拾って「これは古代王の涙です」と書いて展示する。信じた客が金を払う。
> 夜、隣の館長がそれを盗みにくる。

企画書 [`game-concepts/03-my-fake-museum.md`](../../game-concepts/03-my-fake-museum.md) を、
PC・スマートフォン向けのダウンロード型アプリとして実装したもの。

**現状**: v0.1.0 / 単一コードベースで Web・デスクトップ（Electron）・モバイル（Capacitor）に配布可能。
テスト225件 + 実ブラウザE2E 18項目、コアのカバレッジ 97.8%。
検出・修正した不具合は [BUGS.md](./BUGS.md) に全件記載。

---

## 遊び方

1. **朝** — 街を歩いてガラクタを拾う（1日4回）
2. **捏造** — 拾ったものに**自分で説明文を書いて**展示する
3. **開館** — 来館者が「本物だ / 嘘くさい」を投票し、チップを置いていく
4. **夜** — 他館に忍び込んで展示品を盗む。逆に盗まれることもある
5. **書き換え** — 盗んだ品は由来を書き換えて展示できる。ただし**盗品ラベルは永久に消えない**

説明文は2つのルートのどちらでも稼げる。

| ルート | 書き方 | 伸びるもの |
|---|---|---|
| **権威** | 年号・専門用語・固有名詞で本物らしく | 権威 → 高級ケースが解放される |
| **話題** | 誇張と全力のふざけ | 話題 → 来館者が増える |

中途半端が一番損をする。7日ごとに、サーバーに1つだけ**本物**が出現する。

---

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 型検査 + 本番ビルド → dist/
npm run preview    # ビルド結果の確認
```

### テスト

```bash
npm run typecheck               # TypeScript 型検査（strict + noUncheckedIndexedAccess）
npm test                        # ユニット / プロパティ / シミュレーション（225件）
npm run test:cov                # カバレッジ（src/core 対象、しきい値 85%）
npm run test:e2e                # 実ブラウザE2E（Chromium、ビルド込み）
npm run test:all                # 上記すべて

DAYS=1500 SEEDS=4 npm run sim   # 長時間ソーク（約36秒）
DAYS=10000 SEEDS=8 npm run sim  # リリース前の本番ソーク
```

E2E は `PLAYWRIGHT_BROWSERS_PATH` 配下の Chromium を使う。
別の場所にある場合は `CHROMIUM_PATH=/path/to/chrome npm run test:e2e`。

---

## 配布

### デスクトップ（Windows / macOS / Linux）

```bash
npm i -D electron electron-builder   # 初回のみ（約200MB）
npm run electron:dev                 # 開発起動
npm run dist:win                     # → release/ に NSIS インストーラ
npm run dist:mac                     # → release/ に dmg（x64 / arm64）
npm run dist:linux                   # → release/ に AppImage + deb
```

配布物への署名は各OSの証明書が必要（Windows: Authenticode、macOS: Developer ID + notarization）。
`package.json` の `build` セクションに設定済み。

### モバイル（iOS / Android）

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios @capacitor/preferences
npm run cap:add:android     # android/ を生成
npm run cap:add:ios         # ios/ を生成（macOS + Xcode が必要）
npm run cap:sync            # ビルド結果を各プラットフォームへ同期

npx cap open android        # Android Studio で開く
npx cap open ios            # Xcode で開く
```

アプリID は `com.myfakemuseum.game`（`capacitor.config.json`）。

---

## 設計

```
src/
  core/         ← DOM・I/O・グローバル乱数を一切持たない純粋ロジック
    rng.ts          シリアライズ可能な決定論的PRNG（sfc32）
    text.ts         書記素単位のUnicode処理
    moderation.ts   多層モデレーション（難読化対策・PII検出）
    caption.ts      キャプション採点
    economy.ts      金銭・ステータスの不変条件を一元管理
    appraisal.ts    来館者シミュレーション（詳細版 / 高速版）
    heist.ts        夜の略奪
    rivals.ts       ライバル館のAI
    game.ts         リデューサー: apply(state, action) -> state
    save.ts         検証・修復・マイグレーション付きセーブ
  ui/           ← 描画層（フレームワーク非依存）
    render.ts       GameState → 表示用データ（純粋関数）
    app.ts          DOM構築。プレイヤー入力は textContent のみ
    styles.css      モバイルファースト、ライト/ダーク対応
  platform/
    storage.ts      Electron / Capacitor / localStorage の切り替え
electron/       ← デスクトップのメインプロセスとpreload
tests/          ← 225件のテスト + 不変条件定義 + ソーク + E2E
```

### 設計上の決定

**コアを純粋に保つ。** `apply(state, action)` は `structuredClone` で複製してから変更し、
新しい状態を返す。乱数の状態は `GameState` の一部なので、セーブ・ロード・リプレイ・
シードからの完全再現がすべて同じ仕組みで成立する。

**上限値は1箇所で決める。** 書き込み側と読み込み側で別々に上限を持つと、
長期プレイで値が食い違いセーブがずれる（[BUGS.md #9](./BUGS.md)）。
`economy.ts` の `clampMoney` / `clampStat` / `clampTotal` を両方の経路で使う。

**表示は保持、照合は除去。** ZWJ絵文字やペルシャ語の ZWNJ は保存時に残し、
モデレーション照合時にだけ取り除く。逆にすると正当な入力が壊れる
（[BUGS.md #4](./BUGS.md)）。

**セーブは絶対に例外を投げない。** 壊れたセーブは修復して読み込み、
修復内容をユーザーに通知する。読めない場合も元ファイルを消さない。
メインとバックアップの2スロットを保持する。

**オフラインファースト。** v0.1 はサーバーを持たない。ライバル館はローカルのAI。
サーバー同期は後付けできる設計にしてある（コアが純粋なので、状態の送受信で済む）。

---

## 商用リリース前に必要な作業

[BUGS.md §4](./BUGS.md) に詳細。要点のみ:

1. **モデレーション語彙の差し替え** — 現在は代表例のみのシードリスト。
   ベンダー提供の維持リストへ `configureTerms()` で差し替えること（必須）
2. **通報導線と人間レビュー体制** — クライアント側の機構のみ実装済み
3. **バランス調整** — 展示枠が30日台で上限に達する（[BUGS.md B-1](./BUGS.md)）
4. **実機ビルドと署名** — 各OS上での `dist:*` 実行と証明書の取得
5. **ストア素材** — アイコン各サイズ、スクリーンショット、プライバシーポリシー

---

## ライセンス

UNLICENSED（商用プロジェクトにつき非公開）
