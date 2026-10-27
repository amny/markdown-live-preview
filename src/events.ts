// サーバとブラウザ側スクリプトで共有するライブ更新イベント

export type ReloadEvent =
  | { readonly type: 'update'; readonly path: string }
  | { readonly type: 'tree' }
  | { readonly type: 'css' }
  /** ルート配下の画像が追加・変更・削除された */
  | { readonly type: 'asset'; readonly path: string }
  | { readonly type: 'error'; readonly path: string; readonly message: string };

export type FragmentResponse =
  | { readonly ok: true; readonly title: string; readonly html: string }
  | { readonly ok: false; readonly error: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

export const parseReloadEvent = (value: unknown): ReloadEvent | undefined => {
  if (!isRecord(value)) return undefined;
  switch (value['type']) {
    case 'update':
      return typeof value['path'] === 'string' ? { type: 'update', path: value['path'] } : undefined;
    case 'tree':
      return { type: 'tree' };
    case 'css':
      return { type: 'css' };
    case 'asset':
      return typeof value['path'] === 'string' ? { type: 'asset', path: value['path'] } : undefined;
    case 'error':
      return typeof value['path'] === 'string' && typeof value['message'] === 'string'
        ? { type: 'error', path: value['path'], message: value['message'] }
        : undefined;
    default:
      return undefined;
  }
};

/**
 * ページ上の URL（相対も可）を、配信ルートからの相対パス（区切りは `/`）に変換する。
 * 別オリジンや不正なエンコーディングの場合は undefined を返す。
 */
export const rootRelativePathOf = (href: string, base: string): string | undefined => {
  const url = new URL(href, base);
  if (url.origin !== new URL(base).origin) return undefined;
  try {
    return decodeURIComponent(url.pathname).replace(/^\//, '');
  } catch {
    return undefined;
  }
};

export const parseFragmentResponse =(value: unknown): FragmentResponse | undefined => {
  if (!isRecord(value)) return undefined;
  if (value['ok'] === true && typeof value['title'] === 'string' && typeof value['html'] === 'string') {
    return { ok: true, title: value['title'], html: value['html'] };
  }
  if (value['ok'] === false && typeof value['error'] === 'string') return { ok: false, error: value['error'] };
  return undefined;
};
