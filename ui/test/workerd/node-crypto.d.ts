// The part of `node:crypto` the Worker uses, which `nodejs_compat` provides, for checking with the Workers runtime's
// types, which have no Node module. `tsconfig.json` checks the same code against Node's own types.
declare module "node:crypto" {
  interface Hash {
    update(data: Uint8Array): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
}
