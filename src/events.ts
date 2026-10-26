// サーバとブラウザ側スクリプトで共有するライブ更新イベント

export type ReloadEvent =
  | { readonly type: 'update'; readonly path: string }
  | { readonly type: 'tree' }
  | { readonly type: 'css' }
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
    case 'error':
      return typeof value['path'] === 'string' && typeof value['message'] === 'string'
        ? { type: 'error', path: value['path'], message: value['message'] }
        : undefined;
    default:
      return undefined;
  }
};

export const parseFragmentResponse = (value: unknown): FragmentResponse | undefined => {
  if (!isRecord(value)) return undefined;
  if (value['ok'] === true && typeof value['title'] === 'string' && typeof value['html'] === 'string') {
    return { ok: true, title: value['title'], html: value['html'] };
  }
  if (value['ok'] === false && typeof value['error'] === 'string') return { ok: false, error: value['error'] };
  return undefined;
};
