/**
 * Tabs (task M2-07), following the WAI-ARIA tabs pattern: one tab stop for the tab list, Left and
 * Right move between tabs (wrapping), Home and End jump to the ends, and moving selects.
 */
import type { ComponentChildren } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  /** Pass `t()` output. */
  label: string;
  content: ComponentChildren;
}

export interface TabsProps {
  /** Names the tab list. Pass `t()` output. */
  label: string;
  tabs: readonly TabItem[];
  /** The tab shown first (default: the first). */
  initial?: string;
  onSelect?: (id: string) => void;
}

export function Tabs({ label, tabs, initial, onSelect }: TabsProps) {
  const base = useId();
  const [current, setCurrent] = useState(initial ?? tabs[0]?.id ?? "");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === current),
  );
  const active = tabs[index];

  const select = (i: number, focus: boolean): void => {
    const tab = tabs[i];
    if (!tab) return;
    setCurrent(tab.id);
    onSelect?.(tab.id);
    if (focus) refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const n = tabs.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % n;
    else if (e.key === "ArrowLeft") next = (index - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    select(next, true);
  };

  return (
    <div class={styles.tabs}>
      <div class={styles.list} role="tablist" aria-label={label}>
        {tabs.map((tab, i) => {
          const selected = i === index;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${i}`}
              class={styles.tab}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i, false)}
              onKeyDown={onKeyDown}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          class={styles.panel}
          role="tabpanel"
          id={`${base}-panel`}
          aria-labelledby={`${base}-tab-${index}`}
          tabIndex={0}
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
