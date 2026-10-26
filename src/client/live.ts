// ブラウザ側スクリプト。SSE でサーバの変更通知を受け、表示中のページだけを差し替える。
import { parseFragmentResponse, parseReloadEvent, type ReloadEvent } from '../events.js';
import { ERROR_BANNER_ID } from '../render/page.js';

declare global {
  interface Window {
    __mdliveRenderMermaid?: (root?: ParentNode) => Promise<void>;
  }
}

const EVENTS_URL = '/__mdlive/events';
const FRAGMENT_URL = '/__mdlive/fragment';

const currentPath = document.body.dataset['mdlivePath'] ?? '';

const showError = (message: string): void => {
  const banner = document.getElementById(ERROR_BANNER_ID);
  if (banner === null) return;
  banner.textContent = message;
  banner.hidden = false;
};

const hideError = (): void => {
  const banner = document.getElementById(ERROR_BANNER_ID);
  if (banner !== null) banner.hidden = true;
};

const fetchFragment = async (): Promise<void> => {
  const response = await fetch(`${FRAGMENT_URL}?path=${encodeURIComponent(currentPath)}`, { cache: 'no-store' });
  const fragment = parseFragmentResponse(await response.json());
  if (fragment === undefined) throw new Error(`unexpected fragment response (HTTP ${response.status})`);
  if (!fragment.ok) {
    showError(fragment.error);
    return;
  }
  const article = document.querySelector('article.markdown-body');
  if (article === null) throw new Error('article.markdown-body was not found');
  // innerHTML の差し替えのみでページ遷移しないため、スクロール位置は保たれる
  article.innerHTML = fragment.html;
  document.title = fragment.title;
  hideError();
  await window.__mdliveRenderMermaid?.(article);
};

// 更新通知が連続しても取得は 1 本ずつにし、取得中に来た通知は最後に 1 回だけ反映する
let refreshing: Promise<void> | undefined;
let pending = false;

const refresh = (): void => {
  if (refreshing !== undefined) {
    pending = true;
    return;
  }
  refreshing = fetchFragment()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      showError(`mdlive: failed to refresh ${currentPath || 'file list'}: ${message}`);
    })
    .finally(() => {
      refreshing = undefined;
      if (pending) {
        pending = false;
        refresh();
      }
    });
};

const reloadCustomCss = (): void => {
  const link = document.querySelector<HTMLLinkElement>('link[data-mdlive-custom-css]');
  if (link === null) return;
  const url = new URL(link.href);
  url.searchParams.set('t', String(Date.now()));
  link.href = url.toString();
};

const handleEvent = (event: ReloadEvent): void => {
  switch (event.type) {
    case 'update':
      if (event.path === currentPath) refresh();
      return;
    case 'tree':
      if (currentPath === '') refresh();
      return;
    case 'css':
      reloadCustomCss();
      return;
    case 'error':
      if (event.path === currentPath) showError(event.message);
      return;
  }
};

const connect = (): void => {
  const source = new EventSource(EVENTS_URL);
  let disconnected = false;

  source.addEventListener('message', (message: MessageEvent<string>) => {
    try {
      const event = parseReloadEvent(JSON.parse(message.data));
      if (event === undefined) throw new Error(`unknown event: ${message.data}`);
      handleEvent(event);
    } catch (error) {
      console.error('mdlive: failed to handle server event', error);
    }
  });
  source.addEventListener('error', () => {
    disconnected = true;
  });
  // サーバ再起動などで再接続した場合は、切断中の変更を取りこぼさないよう取り直す
  source.addEventListener('open', () => {
    if (disconnected) {
      disconnected = false;
      refresh();
    }
  });
};

connect();
