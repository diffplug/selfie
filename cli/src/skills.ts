// Guides for a coding agent, kept beside the CLI they describe, and printed by `selfie skill`.
import { readFile } from "node:fs/promises";
import { SelfieError } from "./errors.ts";

const SKILLS: readonly string[] = ["quickstart", "fix-flakes"];

export async function readSkill(name: string): Promise<string> {
  // Checked, since this goes in a path.
  if (!SKILLS.includes(name)) throw new SelfieError("usage", `There's no skill "${name}". There's ${SKILLS.join(", ")}.`);
  return readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
}
