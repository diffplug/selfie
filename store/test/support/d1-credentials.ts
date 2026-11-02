import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** The only database real-D1 tests may touch. It holds nothing but their tables. */
export const CONTRACT_DATABASE_ID = "d4872de7-902a-4ce4-bace-a0c8fe0131f9";

export interface D1Credentials {
  readonly accountId: string;
  readonly token: string;
}

const CREDENTIALS_PATH = join(homedir(), ".config", "selfie", "d1.env");

/** Reads the credentials for real-D1 runs. Errors name the file and key, never a value. */
export async function loadD1Credentials(): Promise<D1Credentials> {
  const text = await readFile(CREDENTIALS_PATH, "utf8");
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values.set(match[1]!, match[2]!.replace(/^(["'])(.*)\1$/, "$2"));
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) throw new Error(`${CREDENTIALS_PATH} does not set ${name}`);
    return value;
  };
  return {
    accountId: required("CLOUDFLARE_D1_ACCOUNT_ID"),
    token: required("CLOUDFLARE_D1_TOKEN"),
  };
}
