import { KeybindingHint } from "@primer/react/experimental";

/** A key, as Primer draws one. */
export function Keys({ keys, onPrimary = false }: { readonly keys: string; readonly onPrimary?: boolean }) {
  return <KeybindingHint keys={keys} variant={onPrimary ? "onPrimary" : "normal"} />;
}
