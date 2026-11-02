import type { capture } from "selfie-render";

export const EXIT_OK = 0;
export const EXIT_NEEDS_ATTENTION = 1;
export const EXIT_COULD_NOT_RUN = 2;

/** The command couldn't do its work. Exits 2, with the message as the JSON error. */
export class CliError extends Error {
  override readonly name = "CliError";
}

/** What a command reaches the outside through, so tests can supply their own. */
export interface Context {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Results only: exactly one document per command. */
  readonly stdout: (text: string) => void;
  /** Progress and messages for people. */
  readonly stderr: (text: string) => void;
  readonly capture: typeof capture;
  readonly signal?: AbortSignal;
}

export const printJson = (context: Context, document: unknown) =>
  context.stdout(`${JSON.stringify(document, null, 2)}\n`);
