#!/usr/bin/env node
import { capture } from "selfie-render";
import { runCli } from "./cli.ts";

const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  // Through the signal, so a render stops its container rather than leaving it to its deadline.
  process.once(signal, () => abort.abort());
}

// Through `exitCode`, so stdout finishes flushing to a pipe before the process ends.
process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  capture,
  signal: abort.signal,
});
