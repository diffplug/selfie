import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBlobStorage } from "../../src/adapters/filesystem-blob.ts";
import { SqliteAdapter } from "../../src/adapters/sqlite.ts";
import { Blobs, initStoreSchema, Sql } from "../../src/core/index.ts";

/** A SQLite database and blob directory in a new temp directory. */
export async function createTempStore() {
  const directory = await mkdtemp(join(tmpdir(), "selfie-store-"));
  const path = join(directory, "store.db");
  const adapters: SqliteAdapter[] = [];
  const connectAdapter = () => {
    const adapter = new SqliteAdapter(path);
    adapters.push(adapter);
    return adapter;
  };
  const connect = () => new Sql(connectAdapter());
  const sql = connect();
  await initStoreSchema(sql);
  return {
    path,
    sql,
    connect,
    connectAdapter,
    blob: new Blobs(new FilesystemBlobStorage(join(directory, "blobs"))),
    destroy: async () => {
      for (const adapter of adapters) adapter.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
