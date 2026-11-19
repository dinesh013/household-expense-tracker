/** Moves the item at `from` one place up or down; returns the same order when the move is off the end. */
export function moveItem<T>(list: T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

