import { describe, expect, it } from 'vitest';
import { fitView, panBy, wheelFactor, zoomAt } from '../../src/client/zoom.js';
import { VIEWER_ID, viewerScript } from '../../src/client/viewer.js';

describe('zoomAt', () => {
  it('keeps the given point fixed on screen', () => {
    const view = { scale: 1, x: 10, y: 20 };
    const next = zoomAt(view, 2, 110, 70);
    expect(next).toEqual({ scale: 2, x: -90, y: -30 });
    // 拡大前後で同じ内容上の点 (100, 50) が画面の (110, 70) にある
    expect(100 * next.scale + next.x).toBe(110);
    expect(50 * next.scale + next.y).toBe(70);
  });

  it('clamps the scale to the allowed range', () => {
    expect(zoomAt({ scale: 10, x: 0, y: 0 }, 100, 0, 0).scale).toBe(20);
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.001, 0, 0).scale).toBe(0.1);
    expect(zoomAt({ scale: 20, x: 5, y: 5 }, 2, 100, 100)).toEqual({ scale: 20, x: 5, y: 5 });
  });
});

describe('panBy', () => {
  it('moves without changing the scale', () => {
    expect(panBy({ scale: 3, x: 1, y: 2 }, 10, -5)).toEqual({ scale: 3, x: 11, y: -3 });
  });
});

describe('fitView', () => {
  it('shrinks large content to fit and centers it', () => {
    expect(fitView({ width: 2000, height: 1000 }, { width: 1048, height: 800 }, 1)).toEqual({ scale: 0.5, x: 24, y: 150 });
  });

  it('does not enlarge beyond maxScale', () => {
    expect(fitView({ width: 100, height: 50 }, { width: 1000, height: 600 }, 1)).toEqual({ scale: 1, x: 450, y: 275 });
    expect(fitView({ width: 100, height: 50 }, { width: 248, height: 600 }, Number.POSITIVE_INFINITY).scale).toBe(2);
  });
});

describe('wheelFactor', () => {
  it('zooms in on upward scrolls and out on downward scrolls', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(100, 0, false) * wheelFactor(-100, 0, false)).toBeCloseTo(1);
  });

  it('treats pinch gestures and line-based deltas as stronger', () => {
    expect(wheelFactor(10, 0, true)).toBeLessThan(wheelFactor(10, 0, false));
    expect(wheelFactor(3, 1, false)).toBeCloseTo(wheelFactor(48, 0, false));
  });
});

describe('viewerScript', () => {
  it('is a self-contained script', () => {
    const script = viewerScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(JSON.stringify(VIEWER_ID));
    // 文字列化した関数がバンドラの補助関数などモジュール外の値に依存していないこと
    expect(script).not.toMatch(/\b__name\b|\bimport\b|\brequire\(/);
  });
});
