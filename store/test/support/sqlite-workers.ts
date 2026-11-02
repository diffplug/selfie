import { Worker } from "node:worker_threads";
import type { ImageRow, ParamMode } from "./sql-params.ts";

export interface WorkerInput {
  readonly path: string;
  readonly rows: readonly ImageRow[];
  readonly mode: ParamMode;
  readonly parties: number;
  readonly barrier: SharedArrayBuffer;
}

export interface WorkerOutput {
  readonly keys: number[];
  readonly startedAt: number;
  readonly finishedAt: number;
}

/** Runs each workload on its own thread and connection, starting them together. */
export function runInsertWorkers(
  path: string,
  workloads: readonly (readonly ImageRow[])[],
  mode: ParamMode,
): Promise<WorkerOutput[]> {
  const barrier = new SharedArrayBuffer(4);
  return Promise.all(
    workloads.map(
      (rows) =>
        new Promise<WorkerOutput>((resolve, reject) => {
          const workerData: WorkerInput = {
            path,
            rows,
            mode,
            parties: workloads.length,
            barrier,
          };
          const worker = new Worker(new URL("./sqlite-insert-worker.ts", import.meta.url), {
            workerData,
          });
          worker.once("message", resolve);
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code !== 0) reject(new Error(`Insert worker exited with code ${code}`));
          });
        }),
    ),
  );
}
