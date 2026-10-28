# md-live-preview

Markdown をリアルタイムに HTML 変換してブラウザでライブプレビューする CLI ツール `mdlive`。
外部参照を持たない単一ファイル完結の HTML を書き出すこともできる。

## 特徴

- コマンド一発で Web サーバを起動し、ブラウザを開いてライブプレビュー
- Markdown の追加・変更・削除を検知し、ページを再読み込みせずに本文だけを差し替え（スクロール位置を保持）
- 参照している画像を差し替えると、その画像だけを再読み込み（`--out` 時は埋め込んでいるページを書き出し直す）
- GitHub スタイル（OS の設定に合わせてライト／ダークを自動切り替え。`--theme` で固定も可能）。カスタム CSS で上書き可能、変更も即反映。`--no-default-css` でデフォルトスタイルを外せる
- GitHub Flavored Markdown（テーブル、タスクリスト、取り消し線、自動リンク、脚注）
- Shiki によるシンタックスハイライト、KaTeX による数式、Mermaid による図
- 画像・Mermaid の図をクリックすると全画面のビューアで拡大・縮小・ドラッグできる（`build` の出力でも動作）
- 生 HTML は GitHub 準拠のスキーマでサニタイズ
- フロントマターを GitHub と同じく表で表示（`--front-matter hide` で非表示）
- `:::name` 〜 `:::` で囲んだ範囲を `<div class="name">` に変換（外側のコロンを増やせばネスト可能）
- `build` で画像・CSS・フォント・スクリプトをすべて埋め込んだ単一ファイルの HTML を出力

## 必要環境

- Node.js 22.18 以上
- pnpm

## セットアップ

```bash
pnpm install
pnpm build
```

## 単一実行ファイル（Windows 向け）

Node.js や pnpm がない環境では、Node.js 本体と必要なファイルをすべて含めた実行ファイル `mdlive.exe` を使える。
`main` への push ごとに GitHub Actions の「Build Windows executable」が Windows 上で作成・動作確認し、成果物 `mdlive-windows-x64` として保存する。

```powershell
mdlive.exe [dir]
mdlive.exe build [dir] --out <dir>
```

- オプションは下記の `node dist/cli.js` と同じ
- 約 100MB。コード署名をしていないため、初回起動時に Windows の SmartScreen が警告を出すことがある

手元で作る場合は、対象の OS 上で次を実行する（Windows 上なら `dist-sea/mdlive.exe`、macOS / Linux なら `dist-sea/mdlive` ができる）。

```bash
pnpm build:sea
```

## 使い方

### ライブプレビュー（serve）

```bash
node dist/cli.js [dir]
```

`dir` 省略時はカレントディレクトリ。`serve` サブコマンドは省略できる（`node dist/cli.js serve [dir]` と同じ）。

| オプション | 説明 |
|---|---|
| `--port <n>` | ポート番号（デフォルト 3000）。使用中なら番号を 1 ずつ増やして空きポートを探す |
| `--host <addr>` | バインドアドレス（デフォルト `127.0.0.1`） |
| `--no-open` | ブラウザを自動で開かない |
| `--out <dir>` | 変更のたびに単一ファイル完結の HTML も書き出す |
| `--css <path>` | GitHub スタイルの後に適用するカスタム CSS |
| `--theme <mode>` | 配色。`auto`（OS の設定に追従、デフォルト）/ `light` / `dark` |
| `--no-default-css` | デフォルトスタイル（GitHub スタイルとレイアウト）を使わない。`--css` と組み合わせて独自スタイルだけで表示する |
| `--front-matter <mode>` | フロントマター（先頭の `---` で囲んだ YAML）の表示。`table`（表で表示、デフォルト）/ `hide`（非表示） |

Ctrl+C で終了する。

### HTML 出力（build）

```bash
node dist/cli.js build [dir] --out <dir>
```

| オプション | 説明 |
|---|---|
| `--out <dir>` | 出力先（必須）。ルート配下も指定できるが、ルート自身やその親は不可 |
| `--css <path>` | GitHub スタイルの後に適用するカスタム CSS |
| `--theme <mode>` | 配色。`auto`（OS の設定に追従、デフォルト）/ `light` / `dark` |
| `--no-default-css` | デフォルトスタイル（GitHub スタイルとレイアウト）を使わない。`--css` と組み合わせて独自スタイルだけで表示する |
| `--front-matter <mode>` | フロントマター（先頭の `---` で囲んだ YAML）の表示。`table`（表で表示、デフォルト）/ `hide`（非表示） |
| `--strict` | 参照画像の欠落などの警告をエラー扱いにし、終了コード 1 で終了する |

- ディレクトリ構造を保って `<out>/<path>.html` に出力し、`.md` へのリンクは `.html` に書き換える
- ファイル一覧の `index.html` を生成する（ルートに `index.md` がある場合はそれを使う）
- 出力 HTML は 1 ファイルで配布できる。ただしページ間リンクはリンク先のファイルも必要
- Mermaid を含むページは `mermaid.js` を埋め込むため約 6MB になる

## 画像・図のビューア

本文中の画像や Mermaid の図をクリックすると全画面のビューアが開く。

| 操作 | 動作 |
|---|---|
| ホイール／ピンチ | カーソル・指の位置を中心に拡大・縮小 |
| ドラッグ | 表示位置を移動 |
| ダブルクリック／`0` | 画面に収まる大きさに戻す |
| `+` / `-`、右上のボタン | 拡大・縮小 |
| `Esc`／背景のクリック | 閉じる |

リンクの中の画像はビューアを開かず、リンクとして動作する。

## ディレクティブ

```markdown
::::note
外側
:::warning
内側
:::
::::
```

は `<div class="note"><p>外側</p><div class="warning"><p>内側</p></div></div>` になる。
ネストするときは外側のコロンを内側より多くする。見た目はカスタム CSS で付ける。
ラベル `:::name[ラベル]` は先頭の段落として出力し、属性 `{...}` は無視する。
行内の `:name` や行単位の `::name` は変換せず、そのまま表示する。

## 制限事項

- 外部 URL の画像（`https://...`）は埋め込まずにそのまま残す
- ルートディレクトリ外の画像は埋め込まない

## 開発

```bash
pnpm dev [dir]   # ビルドしてから serve を起動
pnpm build:sea   # 単一実行ファイルを dist-sea/ に作る
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

要件は [docs/requirements.md](docs/requirements.md)、構成と設計上の約束事は [CLAUDE.md](CLAUDE.md) を参照。
