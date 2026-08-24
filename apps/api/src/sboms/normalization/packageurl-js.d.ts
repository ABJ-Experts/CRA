declare module "packageurl-js" {
  export class PackageURL {
    readonly type: string;
    readonly name: string | undefined;
    static fromString(value: string): PackageURL;
    toString(): string;
  }
}
