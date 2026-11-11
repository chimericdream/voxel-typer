/**
 * A bevelled panel (task M2-07). `tone="plate"` is the semi-opaque text plate for anything drawn
 * over the 3D scene (PLAN.md §5.1): text never sits straight on the scene.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import styles from "./Panel.module.css";

export interface PanelProps {
  children: ComponentChildren;
  /** Visible heading; also names the region. Pass `t()` output. */
  heading?: string;
  headingLevel?: 2 | 3;
  tone?: "panel" | "plate";
  class?: string;
}

export function Panel({
  children,
  heading,
  headingLevel = 2,
  tone = "panel",
  class: extra,
}: PanelProps) {
  const id = useId();
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      class={extra ? `${styles.panel} ${extra}` : styles.panel}
      data-tone={tone}
      aria-labelledby={heading ? id : undefined}
    >
      {heading ? (
        <H id={id} class={styles.heading}>
          {heading}
        </H>
      ) : null}
      {children}
    </section>
  );
}
