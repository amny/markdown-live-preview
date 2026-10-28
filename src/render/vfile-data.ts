import type { LinkMode } from './links.js';

export type RenderMeta = {
  readonly title: string;
  readonly hasMath: boolean;
  readonly hasMermaid: boolean;
  /** 本文に画像（<img>）があるか */
  readonly hasImage: boolean;
};

declare module 'vfile' {
  interface DataMap {
    mdlive: { readonly linkMode: LinkMode };
    mdliveMeta: RenderMeta;
    /** 埋め込み対象として参照されたローカル画像（ルートからの相対パス。存在しないものも含む） */
    mdliveImages: readonly string[];
  }
}
