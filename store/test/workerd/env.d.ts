declare namespace Cloudflare {
  interface Env {
    BLOBS: R2Bucket;
    /** Base64, by path under `test/fixtures/png`, since workerd can't read files. */
    PNG_FIXTURES: Record<string, string>;
    // Set only by `pnpm test:d1:workerd`.
    D1_ACCOUNT_ID?: string;
    D1_DATABASE_ID?: string;
    D1_TOKEN?: string;
  }
}
