import type { LinkMode } from './links.js';

export type RenderMeta = {
  readonly title: string;
  readonly hasMath: boolean;
  readonly hasMermaid: boolean;
};

declare module 'vfile' {
  interface DataMap {
    mdlive: { readonly linkMode: LinkMode };
    mdliveMeta: RenderMeta;
  }
}
