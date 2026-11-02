declare namespace Cloudflare {
  interface Env {
    BLOBS: R2Bucket;
    // Set only by `pnpm test:d1:workerd`.
    D1_ACCOUNT_ID?: string;
    D1_DATABASE_ID?: string;
    D1_TOKEN?: string;
  }
}
