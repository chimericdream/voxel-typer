# Playtest facilitator script

One child at a time, about 10 minutes; three kids per age group if you can. You watch, the child
plays, and you write it up in [`playtest-notes.md`](playtest-notes.md). Nothing leaves the laptop.

## Setup

1. **Start the game.** In PowerShell or Git Bash, in the repo folder: `npm ci`, `npm run build`,
   then `npx vite preview`. Open the `Local:` URL it prints (`http://localhost:4173/`). Later, once
   the home server exists, use its address instead (`deploy/README.md`).
2. **Fresh profile.** Open the URL in a private window (Ctrl+Shift+N), so no players exist yet. Or
   press F12 → Application → Storage → **Clear site data**, then reload.
3. **Sound on** at a comfy volume, full screen (F11), and a real keyboard. Check the splash screen
   shows, then step back with your notes sheet and a timer.

## What to say

> "This is a game you play with the keyboard. I can't help, but I'd love to watch."

Then stay quiet. If they ask for help: "What do you think you could try?" Step in only if they are
stuck and upset, or the game breaks.

## What to watch

- **First 60 seconds:** what they press first, and how long the new player screen takes.
- **Stalls:** any pause over about 10 seconds. Note the screen and where they're looking.
- **F and J bumps:** do they find them, use the on-screen hands, or hunt and peck?
- **Mistakes:** what they do after a wrong key. Smile, frown, give up, try again?

## Stay kind

The child comes first, the findings second. Stay calm and warm, praise effort ("You kept going!"),
and never correct or rush. If they look frustrated or want to stop, stop: "Thanks, that was really
helpful." A short session is still useful.

## Three questions afterwards

1. "What was the most fun part?"
2. "Was anything tricky or confusing?"
3. "Would you play it again? What would you want to do next?"

## Owner checks for the M2 gate

- **A 6-year-old completes lesson 1 without instructions:** a Sprout-age child gets from the splash
  screen to the end of lesson 1 with only the sentence above. Note any help you gave.
- **60 fps on an integrated GPU:** on a laptop without a gaming graphics card, in Chrome or Edge,
  F12 → ⋮ → More tools → Rendering → **Frame rendering stats**, then play for a minute and read the
  rate. For the game's own average, run `npm run build:test` and `npx vite preview --mode test`
  instead, and type `__vt.fps()` in the Console during a lesson (the normal build leaves it out).
