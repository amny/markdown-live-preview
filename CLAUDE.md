# CLAUDE.md

## プロジェクト概要

Markdown をリアルタイムに HTML 変換してブラウザでライブプレビューする CLI ツール `mdlive`。
単一ファイル完結の静的 HTML 出力（`build`）も備える。

要件の正本は [docs/requirements.md](docs/requirements.md)。仕様に関わる変更はまずこのドキュメントを更新すること。

## 技術スタック

- Node.js 22.18+ / TypeScript (strict) / ESM / pnpm
- 変換: unified（remark-gfm, remark-math, remark-directive, remark-frontmatter + yaml, rehype-raw, rehype-sanitize, rehype-katex, rehype-slug, @shikijs/rehype）
- サーバ: `node:http` + SSE（WebSocket は使わない）
- 監視: chokidar v4（v5 以降は Node 22.22+ が必要なため据え置き） / ブラウザ起動: open / CLI: commander
- ビルド: tsup / テスト: vitest / 単一実行ファイル: Node.js SEA + postject（`tsup.sea.config.ts`・`scripts/build-sea.ts`、Windows 版は `.github/workflows/build-exe.yml`）

## コマンド

```bash
pnpm install
pnpm build       # tsup でビルド
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm dev [dir]   # ビルドしてから serve を起動（client.js は dist にしか生成されないため）
pnpm build:sea   # 単一実行ファイル（Node.js SEA）を dist-sea/ に作る。対象 OS 上で実行する
```

## ディレクトリ構成

```
src/
  cli.ts              # エントリポイント。引数解釈と serve / build の呼び分け
  options.ts          # オプション型と検証
  events.ts           # サーバとブラウザで共有するライブ更新イベントの型と検証
  log.ts              # ロガー（info / warn / error）
  assets/source.ts    # 同梱アセットの読み込み口（通常はパッケージから、SEA では実行ファイル内から）
  render/
    pipeline.ts       # md → HTML 断片（純粋関数）
    page.ts           # 断片 → 完全な HTML（serve 用 / 出力用テンプレート）
    index-page.ts     # ファイル一覧ページ
    links.ts          # 相対リンク解決・.md → .html 書き換え（rehype プラグイン）
    directives.ts     # :::name → <div class="name"> 変換とサニタイズスキーマ
    alerts.ts         # GitHub のアラート（> [!NOTE] など）→ アイコン付きの div（サニタイズ後に実行）
    front-matter.ts   # フロントマター（YAML）の解析と表への変換
    vfile-data.ts     # VFile.data の型拡張（プラグイン間で渡す情報）
  fs/
    paths.ts          # ルート外参照を防ぐ安全なパス解決
    scan.ts           # 対象 Markdown ファイルの列挙
  watch/watcher.ts    # chokidar ラッパー（debounce・型付きイベント）
  server/
    server.ts         # ルーティング（/, /*.md, /__mdlive/*）
    reload-hub.ts     # SSE 接続管理と配信
    serve.ts          # serve コマンドの本体（変換器・SSE・サーバ・監視の組み立て）
    shutdown.ts       # シグナル受信時の終了処理
  export/
    build.ts          # build コマンドの本体（走査 → 変換 → 書き出し → 一覧生成）
    writer.ts         # .html の出力・削除（build と serve --out で共用）
    sync.ts           # serve --out 用。変更を出力 HTML へ順次反映するキュー
    inline.ts         # 画像を data URI 化する rehype プラグイン
    assets.ts         # CSS・KaTeX フォント・Mermaid を文字列として読み込みキャッシュ
  client/live.ts      # ブラウザ側スクリプト（本文差し替え・Mermaid 再描画・CSS 再読み込み）。tsup で dist/client.js に別途ビルド
  client/viewer.ts    # 画像・図のビューア。関数を文字列化して serve 用・出力用ページにインライン埋め込み
  client/zoom.ts      # ビューアの倍率・位置の計算（純粋関数。viewer.ts と同じく文字列化して埋め込む）
```

## 設計上の約束事

- 変換処理（`render/`）は副作用を持たない純粋関数として実装し、I/O は `fs/`・`export/`・`server/` に閉じ込める。
- `any` は使用禁止。外部入力は `unknown` で受けて型ガードで絞り込む。
- エラーは握りつぶさず、対象ファイルパスと処理段階を含めたメッセージにする。1 ファイルの失敗でサーバを落とさない。
- ファイルパスは必ず `fs/paths.ts` を通して解決し、ルートディレクトリ外へのアクセスを防ぐ。
- GitHub スタイル・KaTeX・Mermaid・client.js などの同梱アセットは `assets/source.ts` を通して読む（パッケージのパスを直接解決しない。SEA で動かなくなるため）。
- `node:` 接頭辞は tsup で消さない（`removeNodeProtocol: false`。`node:sea` は接頭辞なしでは読み込めない）。
- `client/viewer.ts` の `installViewer` と `client/zoom.ts` の関数は `String(fn)` でページに埋め込むため、引数以外のモジュール内の値（import・定数・他の関数）を参照しない。
- 出力 HTML は外部参照を持たない単一ファイル完結形式を維持する（外部 URL 画像を除く）。
- コード・コミットメッセージ・ログ出力は英語、ドキュメントとコメントは日本語でよい。
