// A story's regions, in reading order, to go to and to pick out. The numbers are the ones drawn on the images.
import { Button, Checkbox, FormControl, Stack, Text } from "@primer/react";
import { useEffect, useRef } from "react";
import type { RegionGroup } from "../shared/regions.ts";
import type { RegionSelection } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { plural } from "./plural.ts";
import { describeRegionPlace, describeRegionSize } from "./selection.ts";
import { KindLabel } from "./words.tsx";

interface RegionListProps {
  readonly groups: readonly RegionGroup[];
  readonly selection: RegionSelection;
  readonly onGo: (index: number) => void;
  readonly outlined: boolean;
  readonly onOutlined: (outlined: boolean) => void;
}

export function RegionList({ groups, selection, onGo, outlined, onOutlined }: RegionListProps) {
  const { selected, focused, toggle, setSelected } = selection;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelector("[data-focused]")?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  return (
    <section className="selfie-regions" aria-label="Regions">
      <div className="selfie-regions-header">
        <Text className="selfie-small">
          <strong>{plural(groups.length, "region")}</strong>
          {selected.size > 0 && `, ${selected.size} selected`}. <Keys keys="n" /> and <Keys keys="p" /> go through them, and <Keys keys="x" /> selects.
        </Text>
        <Stack direction="horizontal" align="center" gap="condensed">
          {groups.length > 1 && (
            <>
              <Button size="small" disabled={selected.size === groups.length} onClick={() => setSelected(new Set(groups.keys()))}>
                Select all
              </Button>
              <Button size="small" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </>
          )}
          <FormControl>
            <Checkbox checked={outlined} onChange={(event) => onOutlined(event.target.checked)} />
            <FormControl.Label>Outline them</FormControl.Label>
          </FormControl>
        </Stack>
      </div>
      <ol className="selfie-regions-list" ref={list}>
        {groups.map((group, index) => (
          <li key={index} data-focused={focused === index || undefined} data-selected={selected.has(index) || undefined}>
            <Checkbox aria-label={`Select region ${index + 1}`} checked={selected.has(index)} onChange={() => toggle(index)} />
            <button type="button" className="selfie-region-go" aria-current={focused === index || undefined} onClick={() => onGo(index)}>
              <span className="selfie-region-number" data-kind={group.kind}>
                {index + 1}
              </span>
              <KindLabel kind={group.kind} />
              <span>{describeRegionSize(group)}</span>
              <span className="selfie-muted">{describeRegionPlace(group)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
