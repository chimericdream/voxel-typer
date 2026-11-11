import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The UI kit preview (M2-07) is a developer page in the e2e build. It shows every kit component in
// each theme. Axe runs on each theme at the Sprout letter size; the screenshots are the visual
// baselines for the kit.
const THEMES = ["day", "night", "contrast"] as const;

test.use({ colorScheme: "light" });

for (const theme of THEMES) {
  test(`ui kit, ${theme} theme`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto(`/ui-kit.html?theme=${theme}&scale=1.5`);
    const root = page.locator("#ui-kit");
    await expect(root).toHaveAttribute("data-ready", "1");
    await expect(page.locator(`[data-theme="${theme}"]`)).toHaveCount(1);
    expect(errors).toEqual([]);

    // Bevels are real 9-slice PNGs from bevel.ts.
    const bevel = await page
      .getByRole("button", { name: "Start" })
      .evaluate((el) => getComputedStyle(el).borderImageSource);
    expect(bevel).toMatch(/^url\("data:image\/png;base64,/);

    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);

    await expect(page).toHaveScreenshot(`ui-kit-${theme}.png`);
  });
}

test("ui kit: keyboard only", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ui-kit.html?theme=day");
  await expect(page.locator("#ui-kit")).toHaveAttribute("data-ready", "1");

  // The focus ring is drawn and thick.
  const start = page.getByRole("button", { name: "Start" });
  await start.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(start).toBeFocused();
  const outline = await start.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBeGreaterThanOrEqual(4);

  // Holding Space presses the button in; letting go clicks it.
  await page.keyboard.down(" ");
  await expect(start).toHaveAttribute("data-pressed", "1");
  await page.keyboard.up(" ");
  await expect(start).not.toHaveAttribute("data-pressed", "1");
  await expect(page.getByText("Pressed 1 times.")).toBeVisible();

  // The dialog opens from the keyboard, traps Tab, closes on Escape and gives focus back.
  const help = page.getByRole("button", { name: "Help" });
  await help.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Need a hand?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  // Close → Got it → Later → Close → Got it: four presses, still inside.
  await expect(dialog.getByRole("button", { name: "Got it" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();

  // Tabs: arrows move the selection.
  const blocks = page.getByRole("tab", { name: "Blocks" });
  await blocks.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Tools" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Tools" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("Pickaxes and shovels.");

  // Toggle and slider.
  const music = page.getByRole("switch", { name: "Music" });
  await music.focus();
  await page.keyboard.press("Space");
  await expect(music).toHaveAttribute("aria-checked", "false");
  const sound = page.getByRole("slider", { name: "Sound" });
  await sound.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(sound).toHaveAttribute("aria-valuetext", "70%");
});
