// 画像・Mermaid 図のビューア。本文中の画像や図をクリックすると全画面で開き、拡大・縮小・ドラッグできる。
// serve 用・出力用のどちらのページにも文字列化してインラインで埋め込む（viewerScript）。
// そのため installViewer は引数で受け取るもの以外のモジュール内の値を参照しないこと。
import { fitView, panBy, wheelFactor, zoomAt, type Size, type View } from './zoom.js';

export type ViewerDeps = {
  readonly zoomAt: typeof zoomAt;
  readonly panBy: typeof panBy;
  readonly fitView: typeof fitView;
  readonly wheelFactor: typeof wheelFactor;
};

/** ビューアの要素の id（スタイルの指定と重複起動の防止に使う） */
export const VIEWER_ID = 'mdlive-viewer';

export const installViewer = (deps: ViewerDeps, viewerId: string): void => {
  if (document.getElementById(`${viewerId}-style`) !== null) return;

  const TARGET = 'article.markdown-body img, article.markdown-body pre.mermaid svg';
  const BUTTON_STEP = 1.25;
  // これ以上動いたらクリックではなくドラッグとみなす（px）
  const CLICK_TOLERANCE = 4;

  const style = document.createElement('style');
  style.id = `${viewerId}-style`;
  style.textContent = `
article.markdown-body img:not(a img), article.markdown-body pre.mermaid svg { cursor: zoom-in; }
#${viewerId} { position: fixed; inset: 0; z-index: 2147483000; overflow: hidden; background: rgba(0, 0, 0, 0.85); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
#${viewerId}[hidden] { display: none; }
#${viewerId}.dragging { cursor: grabbing; }
#${viewerId} .${viewerId}-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; background: Canvas; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5); }
#${viewerId} .${viewerId}-stage > * { display: block; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; pointer-events: none; }
#${viewerId} .${viewerId}-toolbar { position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; }
#${viewerId} .${viewerId}-toolbar button { min-width: 36px; height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: rgba(255, 255, 255, 0.15); color: #ffffff; font: 16px/1 system-ui, sans-serif; cursor: pointer; }
#${viewerId} .${viewerId}-toolbar button:hover { background: rgba(255, 255, 255, 0.3); }
#${viewerId} .${viewerId}-scale { min-width: 56px; color: #ffffff; font: 13px/36px system-ui, sans-serif; text-align: center; }
`;
  document.head.append(style);

  const overlay = document.createElement('div');
  overlay.id = viewerId;
  overlay.hidden = true;
  overlay.tabIndex = -1;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Image viewer');

  const stage = document.createElement('div');
  stage.className = `${viewerId}-stage`;

  const toolbar = document.createElement('div');
  toolbar.className = `${viewerId}-toolbar`;
  const scaleLabel = document.createElement('span');
  scaleLabel.className = `${viewerId}-scale`;
  const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.title = title;
    element.setAttribute('aria-label', title);
    element.addEventListener('click', onClick);
    return element;
  };

  let view: View = { scale: 1, x: 0, y: 0 };
  let content: Size = { width: 1, height: 1 };
  let maxFitScale = 1;
  let returnFocus: Element | null = null;
  let previousOverflow = '';

  const viewport = (): Size => ({ width: overlay.clientWidth, height: overlay.clientHeight });

  const apply = (next: View): void => {
    view = next;
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    scaleLabel.textContent = `${Math.round(view.scale * 100)}%`;
  };

  const reset = (): void => apply(deps.fitView(content, viewport(), maxFitScale));

  const zoomCenter = (factor: number): void => {
    const size = viewport();
    apply(deps.zoomAt(view, factor, size.width / 2, size.height / 2));
  };

  const close = (): void => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    stage.replaceChildren();
    document.documentElement.style.overflow = previousOverflow;
    if (returnFocus instanceof HTMLElement || returnFocus instanceof SVGElement) returnFocus.focus();
  };

  toolbar.append(
    button('−', 'Zoom out', () => zoomCenter(1 / BUTTON_STEP)),
    scaleLabel,
    button('+', 'Zoom in', () => zoomCenter(BUTTON_STEP)),
    button('1:1', 'Actual size', () => {
      const size = viewport();
      apply(deps.zoomAt(view, 1 / view.scale, size.width / 2, size.height / 2));
    }),
    button('⤢', 'Fit to screen', reset),
    button('×', 'Close', close),
  );
  overlay.append(stage, toolbar);
  document.body.append(overlay);

  /** 表示する要素の複製と、元の大きさ。画像は本来の大きさ、図は表示中の大きさを使う */
  const prepare = (target: Element): { readonly node: Element; readonly size: Size; readonly maxScale: number } | undefined => {
    const rect = target.getBoundingClientRect();
    if (target instanceof HTMLImageElement) {
      const node = document.createElement('img');
      node.src = target.currentSrc || target.src;
      node.alt = target.alt;
      const natural = target.naturalWidth > 0 && target.naturalHeight > 0;
      const size = natural ? { width: target.naturalWidth, height: target.naturalHeight } : { width: rect.width, height: rect.height };
      return size.width > 0 && size.height > 0 ? { node, size, maxScale: 1 } : undefined;
    }
    if (target instanceof SVGSVGElement) {
      if (rect.width === 0 || rect.height === 0) return undefined;
      const node = target.cloneNode(true);
      if (!(node instanceof SVGSVGElement)) return undefined;
      node.removeAttribute('style');
      node.setAttribute('width', String(rect.width));
      node.setAttribute('height', String(rect.height));
      // 図はベクターのため、画面に収まるまで拡大して開く
      return { node, size: { width: rect.width, height: rect.height }, maxScale: Number.POSITIVE_INFINITY };
    }
    return undefined;
  };

  const open = (target: Element): void => {
    const prepared = prepare(target);
    if (prepared === undefined) return;
    content = prepared.size;
    maxFitScale = prepared.maxScale;
    stage.style.width = `${content.width}px`;
    stage.style.height = `${content.height}px`;
    stage.replaceChildren(prepared.node);
    returnFocus = document.activeElement;
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    overlay.hidden = false;
    reset();
    overlay.focus();
  };

  // 本文はライブ更新で差し替わるため、document でまとめて受ける
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || overlay.contains(event.target)) return;
    const target = event.target.closest(TARGET);
    if (target === null || target.closest('a') !== null) return;
    if (target instanceof HTMLImageElement && !target.complete) return;
    event.preventDefault();
    open(target);
  });

  // ドラッグとピンチ。押下中のポインタの位置を保持する
  const pointers = new Map<number, { readonly x: number; readonly y: number }>();
  let moved = 0;
  let pressedOnBackdrop = false;

  const pinchState = (): { readonly cx: number; readonly cy: number; readonly distance: number } | undefined => {
    const [a, b] = [...pointers.values()];
    if (a === undefined || b === undefined) return undefined;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  overlay.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && toolbar.contains(event.target)) return;
    if (pointers.size === 0) {
      moved = 0;
      pressedOnBackdrop = event.target === overlay;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    overlay.setPointerCapture(event.pointerId);
    overlay.classList.add('dragging');
  });

  overlay.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (previous === undefined) return;
    const before = pinchState();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = pinchState();
    if (before !== undefined && after !== undefined) {
      const zoomed = before.distance > 0 ? deps.zoomAt(view, after.distance / before.distance, before.cx, before.cy) : view;
      apply(deps.panBy(zoomed, after.cx - before.cx, after.cy - before.cy));
      moved += CLICK_TOLERANCE + 1;
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    moved += Math.abs(dx) + Math.abs(dy);
    apply(deps.panBy(view, dx, dy));
  });

  const release = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size > 0) return;
    overlay.classList.remove('dragging');
    // 背景を押して動かさずに離したときだけ閉じる（ドラッグの終わりでは閉じない）
    if (event.type === 'pointerup' && pressedOnBackdrop && moved <= CLICK_TOLERANCE && event.target === overlay) close();
  };
  overlay.addEventListener('pointerup', release);
  overlay.addEventListener('pointercancel', release);

  overlay.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      apply(deps.zoomAt(view, deps.wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey), event.clientX, event.clientY));
    },
    { passive: false },
  );

  overlay.addEventListener('dblclick', (event) => {
    if (event.target instanceof Element && toolbar.contains(event.target)) return;
    reset();
  });

  overlay.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'Escape':
        close();
        break;
      case '+':
      case '=':
        zoomCenter(BUTTON_STEP);
        break;
      case '-':
        zoomCenter(1 / BUTTON_STEP);
        break;
      case '0':
        reset();
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  window.addEventListener('resize', () => {
    if (!overlay.hidden) reset();
  });
};

/** ページに埋め込むビューアのスクリプト。`<head>` に置けるよう、本文の読み込み後に起動する */
export const viewerScript = (): string => `(() => {
  const install = () => (${String(installViewer)})({ zoomAt: ${String(zoomAt)}, panBy: ${String(panBy)}, fitView: ${String(fitView)}, wheelFactor: ${String(wheelFactor)} }, ${JSON.stringify(VIEWER_ID)});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();`;
