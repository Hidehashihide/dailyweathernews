# Mac で遊ぶ

手間の少ない順に3通り。**まずは方法1**で十分です。

---

## 方法1: HTMLファイルをダブルクリック（インストール不要・1分）

`MY-FAKE-MUSEUM.html` という1ファイルだけで完結します。ゲーム本体もセーブ機能も全部この中に入っています。

1. `MY-FAKE-MUSEUM.html` をダウンロード（デスクトップなど好きな場所に置く）
2. ダブルクリック

以上です。Node.js も git も要りません。

**セーブについて**: ブラウザのローカルストレージに保存されます。同じブラウザで同じファイルを開き続ける限り残ります。

- **Google Chrome / Firefox / Edge を推奨**（検証済み）
- **Safari は保存が効かない可能性があります**。`file://` で開いたページのストレージ制限が厳しいためです。保存できない場合はアプリ内に「保存できていません」と警告が出るので、その時は Chrome で開くか、方法2・3を使ってください
- ファイルを別の場所に移動するとセーブは引き継がれません（ブラウザがファイルパスごとに保存領域を分けるため）。**置き場所を決めてから遊び始めてください**

自分でビルドし直す場合:

```bash
npm run build:standalone     # → dist-standalone/MY-FAKE-MUSEUM.html
```

---

## 方法2: 本物の Mac アプリとして起動する（5分）

パッケージ化はせず、Electron でそのまま起動します。セーブはブラウザではなくディスク上のファイルになるので確実です。

### 準備

Node.js 20 以上が必要です。入っていなければ:

```bash
# Homebrew がある場合
brew install node

# もしくは https://nodejs.org/ から LTS をダウンロード
node -v      # v20.x 以上であることを確認
```

### 手順

```bash
git clone https://github.com/Hidehashihide/dailyweathernews.git
cd dailyweathernews
git checkout claude/viral-game-concepts-53u2sk
cd apps/my-fake-museum

npm install        # Electron のダウンロードを含むので初回は数分かかります
npm run electron:dev
```

ウィンドウが開いてゲームが始まります。

**セーブの場所**: `~/Library/Application Support/MY FAKE MUSEUM/saves/`
書き込みは一時ファイル経由の原子的な置き換えなので、途中でアプリが落ちてもセーブが壊れません。メインとバックアップの2スロットを保持します。

---

## 方法3: .app / .dmg にパッケージ化する（配布用）

人に配ったり、Launchpad から起動したい場合。

```bash
cd apps/my-fake-museum

# Apple Silicon (M1/M2/M3/M4) の Mac
npm run dist:mac:arm64

# Intel Mac
npm run dist:mac:x64

# 両方まとめて
npm run dist:mac
```

`release/` に `.dmg` と `.app` ができます。

### Gatekeeper について

自分のMacでビルドしたものをそのまま開く分には問題ありません。
ただし **`.dmg` を他人に配ったり、一度どこかにアップロードしてダウンロードし直すと**、署名がないため次のように出ます。

> 「MY FAKE MUSEUM」は、開発元を検証できないため開けません。

対処は2つ。

**A. 右クリックで開く（1回だけ）**
Finder でアプリを右クリック →「開く」→ ダイアログで「開く」。2回目以降は普通に起動できます。

**B. 隔離属性を外す**
```bash
xattr -dr com.apple.quarantine "/Applications/MY FAKE MUSEUM.app"
```

**正式に配布する場合**は Apple Developer Program（年間 $99）に登録し、Developer ID 証明書での署名と notarization が必要です。`package.json` の `build.mac` に設定の器は用意してあります。

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `npm install` が `EACCES` で失敗する | `sudo` は使わず、Homebrew か nvm で入れた Node を使ってください |
| `npm run electron:dev` でウィンドウが出ない | `node -v` が 20 以上か確認。それでも出なければ `npx electron --version` でバイナリが落ちているか確認 |
| HTMLファイル版でセーブされない | Safari を使っていませんか。Chrome で開くか、方法2を使ってください |
| ビルドが `Command Line Tools` を要求する | `xcode-select --install` |
| `.app` が「壊れているため開けません」 | 上記 Gatekeeper の対処B（`xattr -dr`）を実行してください |

---

## 検証済みの範囲

| 項目 | 状態 |
|---|---|
| 単一HTMLを `file://` から起動・1日プレイ・リロード後の復元 | ✅ Chromium で自動テスト済み（`npm run test:standalone`） |
| Electron アプリの起動・ディスク保存・**再起動後の復元** | ✅ 自動テスト済み（`npm run test:desktop`） |
| preload ブリッジの分離（Node グローバルの非漏洩、`../` パスの拒否） | ✅ 自動テスト済み |
| macOS 上での `.dmg` 生成・Gatekeeper の挙動・署名 | ⚠️ **未検証**。開発環境が Linux のため実機確認ができていません |
| Safari でのローカルストレージ | ⚠️ **未検証**。上記の理由で Chrome を推奨しています |
