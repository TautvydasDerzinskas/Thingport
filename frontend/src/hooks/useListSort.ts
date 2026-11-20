import { useState } from "react";
import { defaultSortDirection, type SortDirection } from "../utils/sortDirection";

export function useListSort<T extends string>(initial: T, initialDirection = defaultSortDirection(initial)) {
  const directionFor = (value: T) => (value === initial ? initialDirection : defaultSortDirection(value));
  const [sort, setSort] = useState({ value: initial, direction: initialDirection });
  return {
    ...sort,
    onChange: (value: T) =>
      setSort((current) => (value === current.value ? current : { value, direction: directionFor(value) })),
    onDirectionChange: (direction: SortDirection) => setSort((current) => ({ ...current, direction })),
  };
}
