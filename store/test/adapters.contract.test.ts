import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBlobStorage } from "../src/adapters/filesystem-blob.ts";
import { SqliteAdapter } from "../src/adapters/sqlite.ts";
import { describeBlobContract } from "./contract/blob-contract.ts";
import { describeSqlContract } from "./contract/sql-contract.ts";
import { runInsertWorkers } from "./support/sqlite-workers.ts";

describeSqlContract("local SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selfie-sqlite-"));
  const path = join(directory, "store.db");
  const connections: SqliteAdapter[] = [];
  return {
    connect: async () => {
      const connection = new SqliteAdapter(path);
      connections.push(connection);
      return connection;
    },
    // node:sqlite blocks its thread, so only separate threads can overlap.
    insertConcurrently: async (workloads, mode) => {
      const outputs = await runInsertWorkers(path, workloads, mode);
      return outputs.map((output) => output.keys);
    },
    destroy: async () => {
      for (const connection of connections) connection.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
});

describeBlobContract("filesystem", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selfie-blob-"));
  return {
    open: async () => new FilesystemBlobStorage(directory),
    destroy: () => rm(directory, { recursive: true, force: true }),
  };
});
