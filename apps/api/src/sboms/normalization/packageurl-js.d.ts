declare module "packageurl-js" {
  export class PackageURL {
    readonly type: string;
    readonly namespace: string | undefined;
    readonly name: string | undefined;
    readonly version: string | undefined;
    static fromString(value: string): PackageURL;
    toString(): string;
  }
}
