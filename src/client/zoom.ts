// 画像ビューアの表示位置・倍率の計算（純粋関数）。
// 表示は `translate(x, y) scale(scale)`（変形の原点は左上）で表す。
// 各関数は文字列化してページに埋め込むため、他の関数やモジュール内の定数を参照しないこと。

export type View = {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
};

export type Size = {
  readonly width: number;
  readonly height: number;
};

/** 点 (px, py) を画面上で動かさずに倍率を factor 倍する。倍率は min〜max に収める */
export const zoomAt = (view: View, factor: number, px: number, py: number, min = 0.1, max = 20): View => {
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
};

export const panBy = (view: View, dx: number, dy: number): View => ({ ...view, x: view.x + dx, y: view.y + dy });

/** 内容を画面中央に、余白を残して収まる大きさで置く。maxScale より大きくはしない */
export const fitView = (content: Size, viewport: Size, maxScale: number, margin = 24): View => {
  const fit = Math.min((viewport.width - margin * 2) / content.width, (viewport.height - margin * 2) / content.height);
  const scale = Math.max(0.01, Math.min(maxScale, fit));
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
};

/** ホイールの移動量から拡大率を求める。トラックパッドのピンチ（ctrlKey 付き）は感度を上げる */
export const wheelFactor = (deltaY: number, deltaMode: number, pinch: boolean): number => {
  // deltaMode: 0 = ピクセル、1 = 行、2 = ページ
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-pixels * (pinch ? 0.01 : 0.002));
};
