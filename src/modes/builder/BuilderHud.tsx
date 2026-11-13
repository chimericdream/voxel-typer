/**
 * Builder's HUD (task M4-07): the command line, the block palette, a short help line and where
 * the cursor is. It replaces the lesson HUD while Builder runs; the island needs the screen, so
 * there is no on-screen keyboard here.
 *
 * It reads one slice of `HudState.custom` (`hud.ts`), which the mode replaces whenever something
 * on it changes. Like the lesson HUD it takes no pointer input and never takes focus.
 *
 * **Palette.** Up to six blocks, the ones the player owns most of, each as a picture with its
 * count. Under each picture is what to type: for Sprout the short code as key caps (`KeyCap`,
 * one per letter), for Miner and Builder the block's word. The block in hand is outlined.
 */
import { useComputed } from "@preact/signals";
import { t } from "@/i18n";
import { blockIconUri } from "@/ui/components/BadgeIcon";
import type { HudFields } from "@/ui/hud/bridge";
import { KeyCap } from "@/ui/kit/KeyCap";
import { Panel } from "@/ui/kit/Panel";
import { Slot } from "@/ui/kit/Slot";
import { Toast } from "@/ui/kit/Toast";
import { builderHudOf } from "./hud";
import type { BuilderHudSlice, PaletteItem } from "./hud";
import styles from "./BuilderHud.module.css";

function Palette({ slice }: { slice: BuilderHudSlice }) {
  const caps = slice.band === "sprout";
  return (
    <ul class={styles.palette} aria-label={t("builder.palette.label")} data-builder="palette">
      {slice.palette.map((item: PaletteItem) => {
        const icon = blockIconUri(item.block);
        return (
          <li
            key={item.block}
            class={styles.item}
            data-armed={slice.armed === item.block ? "1" : undefined}
            data-block={item.block}
            data-count={item.count}
          >
            <Slot
              label={t("builder.palette.item", {
                name: item.name,
                count: item.count,
                word: item.word,
              })}
              count={item.count}
              selected={slice.armed === item.block}
              {...(icon !== "" && { icon: <img src={icon} alt="" /> })}
            />
            {caps ? (
              <span class={styles.caps} aria-hidden="true">
                {Array.from(item.word).map((ch, i) => (
                  // oxlint-disable-next-line react/no-array-index-key -- reason: a word's letters never reorder, and letters repeat
                  <KeyCap key={i} glyph={ch} />
                ))}
              </span>
            ) : (
              <span class={styles.word} aria-hidden="true">
                {item.word}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CommandLine({ slice }: { slice: BuilderHudSlice }) {
  const empty = slice.line === "";
  return (
    <div class={styles.lineRow}>
      <div
        class={styles.line}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: the prompt, text and caret are one picture of the line, named by aria-label
        role="img"
        aria-label={empty ? t("builder.line.empty") : t("builder.line.label", { text: slice.line })}
        data-builder="line"
        data-text={slice.line}
      >
        <span class={styles.prompt} aria-hidden="true">
          ›
        </span>
        {empty ? (
          <span class={styles.placeholder} aria-hidden="true">
            {t("builder.line.empty")}
          </span>
        ) : (
          <span class={styles.typed} aria-hidden="true">
            {slice.line}
          </span>
        )}
        <span class={styles.caret} aria-hidden="true" />
        {slice.completion === "" ? null : (
          <span class={styles.completion} aria-hidden="true">
            {slice.completion}
          </span>
        )}
      </div>
      {slice.waits ? (
        <span class={styles.space}>
          <KeyCap glyph={t("builder.line.space")} wide />
        </span>
      ) : null}
    </div>
  );
}

function Where({ slice }: { slice: BuilderHudSlice }) {
  const armed = slice.palette.find((p) => p.block === slice.armed);
  return (
    <div class={styles.where}>
      <p class={styles.plate} data-builder="armed" data-block={slice.armed ?? ""}>
        {armed === undefined
          ? t("builder.palette.none")
          : t("builder.palette.armed", { name: armed.name })}
      </p>
      <p class={styles.plate} data-builder="layer">
        {t("builder.where.layer", { layer: slice.layer })}
        {" · "}
        {t("builder.where.facing", { dir: t(`builder.dir.${slice.facing}`) })}
      </p>
    </div>
  );
}

function Help({ slice }: { slice: BuilderHudSlice }) {
  const plans = slice.plans ?? [];
  return (
    <div class={styles.help} data-builder="help">
      <p class={styles.plate}>
        <span class={styles.words}>
          <b>{t("builder.help.put")}</b>
          <b>{t("builder.help.dig")}</b>
          <b>{t("builder.help.undo")}</b>
          {slice.photo === true ? <b>{t("builder.help.photo")}</b> : null}
        </span>
      </p>
      {plans.length > 0 ? (
        <p class={styles.plate} data-builder="plans" data-text={plans.join(" ")}>
          {t("builder.help.plans")}{" "}
          <span class={styles.words}>
            {plans.map((p) => (
              <b key={p}>{p}</b>
            ))}
          </span>
        </p>
      ) : null}
      <p class={styles.plate}>{t("builder.help.move")}</p>
      <p class={styles.plate}>{t("builder.help.keys")}</p>
    </div>
  );
}

/** The calm note for an island that could not be opened. Nothing here can change the save. */
function Resting() {
  return (
    <div class={styles.resting} data-builder="damaged">
      <Panel>
        <h1 class={styles.restingTitle}>{t("builder.damaged.title")}</h1>
        <p class={styles.restingText}>{t("builder.damaged.body")}</p>
        <p class={styles.restingText}>{t("builder.damaged.help")}</p>
      </Panel>
    </div>
  );
}

export interface BuilderHudProps {
  fields: HudFields;
}

export default function BuilderHud({ fields }: BuilderHudProps) {
  // Only Builder's own slice is a dependency, so other `custom` slices don't re-render this.
  const slice = useComputed(() => builderHudOf(fields.custom.value)).value;
  if (slice === null || slice.status === "loading") return null;
  if (slice.status === "damaged") return <Resting />;
  return (
    <div class={styles.hud} data-builder="hud">
      <Palette slice={slice} />
      <div class={styles.stage}>
        <div class={styles.messages}>
          {slice.hint === null ? null : (
            <Toast key={`${slice.hint.key}:${slice.hint.tone}`} tone={slice.hint.tone}>
              {t(slice.hint.key, slice.hint.params)}
            </Toast>
          )}
        </div>
      </div>
      <div class={styles.bottom}>
        <Help slice={slice} />
        <CommandLine slice={slice} />
        <Where slice={slice} />
      </div>
    </div>
  );
}
