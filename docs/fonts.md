# Fonts

Voxel Typer self-hosts three fonts, all under the SIL Open Font License 1.1. The files are in
`public/fonts/` and are served from the app's own origin. The `@font-face` rules are in
`src/ui/theme/fonts.css`. The game never loads a font from a CDN or any other host
(`tests/e2e/fonts.spec.ts` checks this with request interception).

| Family                | Role                                                        | Files in `public/fonts/`                                                | Bytes (WOFF2)     |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| Pixelify Sans         | Pixel font: headings, HUD, buttons (`--font-pixel`)         | `PixelifySans-wght.woff2` (variable, weight 400–700)                    | 22,984            |
| Atkinson Hyperlegible | Body text, words, sentences, single letters (`--font-body`) | `AtkinsonHyperlegible-Regular.woff2`, `AtkinsonHyperlegible-Bold.woff2` | 23,196 + 23,776   |
| OpenDyslexic          | Dyslexia toggle (Settings `font: 'dyslexic'`)               | `OpenDyslexic-Regular.woff2`, `OpenDyslexic-Bold.woff2`                 | 103,336 + 108,068 |

Total: 281,360 bytes. WOFF2 is already compressed, so gzip doesn't shrink it (gzip -9 adds about
60 bytes per file). These files count toward the 3 MB total `dist/` budget (`contracts.md` §14),
not the JS budgets.

## Sources and licenses

Each file was downloaded from the font's own GitHub repository, pinned to a commit, and is
committed **byte for byte as published** (only the Pixelify Sans file name changed, from
`PixelifySans[wght].woff2`, to avoid brackets in URLs). The license text was copied from the same
commit. All three licenses are the unmodified SIL OFL 1.1 text (checked by diffing the three
license bodies) with each project's own copyright line.

| Font                        | Repository and commit                                                                                                                                                     | Files used                                                                                            | License file                                         | Reserved Font Name |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------ |
| Pixelify Sans 1.0           | <https://github.com/eifetx/Pixelify-Sans> at [`39df74a`](https://github.com/eifetx/Pixelify-Sans/tree/39df74aba80df8157546034b878e8be1eb565ced)                           | `fonts/webfonts/PixelifySans[wght].woff2`                                                             | `public/fonts/LICENSES/PixelifySans-OFL.txt`         | none               |
| Atkinson Hyperlegible 1.393 | <https://github.com/googlefonts/atkinson-hyperlegible> at [`1cb3116`](https://github.com/googlefonts/atkinson-hyperlegible/tree/1cb311624b2ddf88e9e37873999d165a8cd28b46) | `fonts/webfonts/AtkinsonHyperlegible-Regular.woff2`, `fonts/webfonts/AtkinsonHyperlegible-Bold.woff2` | `public/fonts/LICENSES/AtkinsonHyperlegible-OFL.txt` | none               |
| OpenDyslexic                | <https://github.com/antijingoist/opendyslexic> at [`1824da5`](https://github.com/antijingoist/opendyslexic/tree/1824da5c0e41dc3e13ffc7f3a636dcaf695d61b7)                 | `compiled/OpenDyslexic-Regular.woff2`, `compiled/OpenDyslexic-Bold.woff2`                             | `public/fonts/LICENSES/OpenDyslexic-OFL.txt`         | "OpenDyslexic"     |

Versions are the `head` version in each WOFF2 file. The upstream repositories have no GitHub
releases, so the commit is the pin.

SHA-256 of the committed files:

```
807d95f498d0ccc257522b02d34ed48efe4e01496ffa345dab3779dd84ad08f5  PixelifySans-wght.woff2
2df4ba17804bc7a36f123127966075d8427bff2df58d0d76820c1130bb1a4150  AtkinsonHyperlegible-Regular.woff2
da8fce41a04f8498fbf79076f92d304b12e70c76f71b143c5dcfb6536c93c075  AtkinsonHyperlegible-Bold.woff2
0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695  OpenDyslexic-Regular.woff2
b534a0b84ef3cca941ebdb506ce3f4e0010aa4ef881271bac8b6959dbf694fbf  OpenDyslexic-Bold.woff2
b66ba46f511a851ab09998b5a5a9fdbb102545a3864cb993095e1745996873a7  LICENSES/PixelifySans-OFL.txt
f32d22b3908fcad2c86a74000614ec22e6a7f66ea7e867e616026a27aebdc143  LICENSES/AtkinsonHyperlegible-OFL.txt
caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b  LICENSES/OpenDyslexic-OFL.txt
```

### No subsetting

The card allows a Latin subset, but none was made:

- OpenDyslexic's license reserves the name "OpenDyslexic". A subset is a Modified Version under
  the OFL, and a Modified Version may not use a Reserved Font Name, so a subset would have to be
  renamed. Shipping the upstream file unchanged keeps the name and avoids the question.
- Pixelify Sans and Atkinson Hyperlegible are about 23 KB per face already. A Latin subset would
  save little.
- Browsers fetch a face only when text uses it, so the larger OpenDyslexic files cost nothing
  until a player turns the dyslexia toggle on.

If a later task does subset a font, it must rename any font with a Reserved Font Name (today only
OpenDyslexic), record the tool, command and Unicode ranges here, and keep the license file.

## Loading

- Every `@font-face` uses `font-display: swap`, so text shows at once in the fallback stack from
  `tokens.css` and swaps when the font arrives.
- `index.html` preloads only `/fonts/PixelifySans-wght.woff2` (with `crossorigin`, as font
  preloads need). The body and dyslexia fonts are not preloaded.
- `src/main.ts` imports `fonts.css`. The URLs are root-absolute (`/fonts/…`), which Vite leaves
  alone, so they match the preload URL exactly.
- The CSP already allows this: `font-src 'self'`.
- The font files are not content-hashed. `deploy/nginx.conf` serves them `no-cache` (always
  revalidated), so a font update reaches players on the next load.

## Legibility check: single-letter targets use Atkinson Hyperlegible

`a d b q l I 1` were rendered at 24 px in Pixelify Sans (400 and 700), Atkinson Hyperlegible and
OpenDyslexic (Chromium, Playwright, 1× and 3× device scale).

Findings for Pixelify Sans at 24 px:

- `b`/`d` and `q`/`p` are exact pixel mirror images of each other. Mirror-letter reversal is the
  classic confusion for early readers.
- `1` differs from `l` only by a one-pixel flag. `l` is a bare vertical bar.
- `a` is single-storey, with a one-pixel tail, and reads close to `d` and `q` without their stems.
- `I` has serifs and is clear.

Atkinson Hyperlegible was designed to separate exactly these shapes: `q` has a tail, `l` has a
tail, `1` has a full flag and base, and `I` has serifs.

**Decision:** single-letter typing targets (and any target shorter than 4 characters) use
`--font-body` (Atkinson Hyperlegible), not the pixel font. Pixelify Sans stays for headings, the
HUD, buttons and other text that isn't something the child has to type. This follows the priority
order: accessibility and learning effectiveness come before visual style. M2-14 (HUD word
display) should use `--font-body` for all typing targets.
