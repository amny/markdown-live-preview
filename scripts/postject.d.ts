// postject は型定義を同梱しないため、使う API だけを宣言する
declare module 'postject' {
  export type InjectOptions = {
    readonly sentinelFuse?: string;
    readonly machoSegmentName?: string;
    readonly overwrite?: boolean;
  };
  export const inject: (
    filename: string,
    resourceName: string,
    resourceData: Buffer,
    options?: InjectOptions,
  ) => Promise<void>;
}
