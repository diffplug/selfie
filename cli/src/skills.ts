// Guides for a coding agent, kept beside the CLI they describe, and printed by `selfie skill`.
import { readFile } from "node:fs/promises";
import { SelfieError } from "./errors.ts";

export const SKILLS = [{ name: "fix-flakes", description: "Make every story render the same way every time." }] as const;

export async function readSkill(name: string): Promise<string> {
  if (!SKILLS.some((skill) => skill.name === name)) {
    throw new SelfieError("usage", `There's no skill "${name}". There's ${SKILLS.map((skill) => skill.name).join(", ")}.`);
  }
  return readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
}
