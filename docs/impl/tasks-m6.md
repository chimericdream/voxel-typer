# Tasks: M6 Polish, PWA, hardening, release

Field legend: see the top of `tasks-m0-m1.md`.

---

### M6-01 Procedural music
- **Size/Tier:** M / A · **Review:** required (feel)
- **Depends on:** M2-06, M5-07
- **PLAN refs:** §5.2
- **Owns:** `src/audio/music/*.ts`, `src/content/biomes/music.ts`
- **Spec:** Generative pentatonic layers per biome (pad, bass, arpeggio, percussion-lite), day/night variants (night: fewer notes, softer, lower), a menu theme. Intensity (0–1, from streak) adds layers with 2-bar crossfades. Seeded per biome so it's recognizable; tempo 70–100 BPM; scheduling via a lookahead scheduler on `AudioContext.currentTime`. CPU budget: < 3% main-thread time (measured in a perf trace).
- **Acceptance:**
  - [ ] Reviewer listens (or inspects scheduling logs) and confirms no clipping (master peak < −1 dBFS in an `OfflineAudioContext` render test) and no jarring transitions.

### M6-02 Juice pass
- **Size/Tier:** M / A · **Review:** required (feel)
- **Depends on:** M5-GATE
- **PLAN refs:** §3.4
- **Owns:** changes across `src/render/fx/`, `src/ui/kit/`, `src/render/post.ts` (new), mode `view` files (coordinate in brief: list exact files before starting)
- **Spec:** Go through `PLAN.md` §3.4 item by item and the M2/M4/M5 review notes. Add: UI squash-and-stretch on button press and star fill; bloom on lanterns/crystals and vignette (post-processing at `high` only, cheap custom passes or `three/examples` EffectComposer if under budget); ambient chickens wander in Meadow and on the island; water shader polish. Every addition respects reduced motion and the flash guard.
- **Acceptance:**
  - [ ] Before/after screenshot pairs in the handoff note; draw-call and frame-time budgets still met.

### M6-03 Auto quality scaler and performance pass
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M5-GATE
- **PLAN refs:** §6.4
- **Owns:** `src/render/quality-scaler.ts`, `src/render/mesher/worker.ts`, `src/render/mesher/greedy.ts`, `tests/unit/render/quality-scaler.test.ts`
- **Spec:** Scaler (pure logic + small adapter): if p90 frame time > 20 ms for 2 s, step down (shadows → post → point lights → render scale 0.75 → 0.5); step up after 10 s under 12 ms, with hysteresis, at most one change per 5 s, only when `settings.quality === 'auto'`. Move chunk meshing to a Web Worker (transferable buffers) when more than 8 chunks are dirty. Greedy meshing for opaque faces (AO-aware: only merge quads with equal AO and tile). Profile Mine, Defense (30 mobs) and Builder (full island) with Playwright tracing under 4× CPU throttle and fix the top 3 hot spots.
- **Acceptance:**
  - [ ] Scaler unit tests (step down/up, hysteresis).
  - [ ] Greedy mesher produces identical rendered output to the culled mesher (pixel-compare screenshot test) with ≥ 40% fewer triangles on the island.
  - [ ] `contracts.md` §14 budgets met; numbers in the handoff note.

### M6-04 Lite 2D mode (no WebGL)
- **Size/Tier:** L / B · **Review:** required
- **Depends on:** M5-GATE
- **PLAN refs:** §6.4 (fallback)
- **Owns:** `src/render/lite/**`, `tests/e2e/lite.spec.ts`
- **Spec:** If WebGL2 is unavailable (or `?lite=1`), `SceneHandle.lite` is a 2D canvas renderer: flat side-view sprites from the same atlas (blocks as 2D tiles, mobs as flattened front views of their models rendered once with a tiny software rasterizer or as hand-composed 2D sprite sheets from the model parts), the same HUD, keyboard and DOM UI. Every mode supports lite with a simplified scene: Mine (block in front of a parallax tile backdrop), Defense (lanes left-to-right), Minecart (side-scrolling track), Builder (top-down layer editor with layer up/down), Boss (front-facing boss sprite). Map becomes a 2D island illustration.
- **Acceptance:**
  - [ ] E2E with WebGL disabled (`--disable-gpu --disable-webgl`) plays a lesson in every mode.

### M6-05 PWA: manifest, icons, service worker, offline, updates
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M5-GATE
- **PLAN refs:** §6.1, `README.md` §8.6
- **Owns:** `public/manifest.webmanifest`, `tools/gen-icons.ts`, `public/icons/*` (generated), `src/app/sw-register.ts`, `vite.config.ts` (PWA plugin section), `src/ui/components/UpdateToast.tsx`, `tests/e2e/pwa.spec.ts`
- **Spec:** Use `vite-plugin-pwa` (`generateSW`, precache all built assets, no runtime caching of external URLs since there are none). Register only when `window.isSecureContext` (`contracts.md` §15 note); over plain HTTP the game still runs online and the Grown-ups settings tab explains why offline play is unavailable. Icons generated from the voxel logo at 192/512 + maskable. Update flow: when a new SW is waiting, show "A new version is ready! Restart when you finish this lesson" and apply only from menus, never mid-lesson.
- **Acceptance:**
  - [ ] E2E: load, go offline (`context.setOffline(true)`), reload, play a lesson.
  - [ ] Installable: manifest valid and `beforeinstallprompt` fires in Chromium.

### M6-06 CSP, privacy and no-network guarantees
- **Size/Tier:** S / B · **Review:** required (privacy)
- **Depends on:** M6-05
- **PLAN refs:** §6.1 (CSP), §6.7
- **Owns:** `index.html` (CSP), `vite.config.ts` (CSP-related bits), `deploy/nginx.conf` or `deploy/Caddyfile` (headers), `tests/deploy/headers.test.ts`, `tests/e2e/privacy.spec.ts`, `docs/privacy.md`
- **Spec:** Final CSP: remove `'unsafe-inline'` from `style-src` if possible (CSS modules are files; inline `style` attributes from Preact are allowed by `style-src-attr` — check browser support and record); `connect-src 'self'`. Keep the meta CSP and the server's CSP header (M0-05) identical; a test compares them. `frame-ancestors 'none'` lives in the header only, since browsers ignore it in a meta tag. E2E records every request during a full playthrough and asserts all are same-origin; asserts no `localStorage` use except documented keys; no cookies.
- **Acceptance:**
  - [ ] Zero third-party requests; no CSP violations in the console during e2e.

### M6-07 Pseudo-locale and text-length stress
- **Size/Tier:** S / C · **Review:** optional
- **Depends on:** M1-12, M5-GATE
- **PLAN refs:** §6.1/Phase 6 (i18n scaffolding)
- **Owns:** `src/i18n/pseudo.ts`, `tests/e2e/pseudo-locale.spec.ts`
- **Spec:** `en-XA` wraps each string in `⟦…⟧`, adds 40% length with accented vowels. E2E screenshots every menu screen in `en-XA` and checks nothing overflows its container (`scrollWidth <= clientWidth` on text nodes' parents) at text scale 1.0 and 2.0. Typing targets are **not** pseudo-localized (they are content).
- **Acceptance:**
  - [ ] No overflow on any screen.

### M6-08 Content and sensitivity review pack
- **Size/Tier:** M / A · **Review:** required · 👤
- **Depends on:** M5-GATE
- **PLAN refs:** §10 (word list safety), §12.7
- **Owns:** `tools/dump-content.ts`, `docs/review/all-content.txt`, `docs/review/README.md`
- **Spec:** Dump every kid-facing string (UI copy, lesson titles, banners, all word lists, sentences, boss lines, achievement text) with its source file. Run an automated pass: blocklist, IP terms, reading-level heuristics (syllables per word for Sprout pools), sentiment check for negative/pressure words in UI copy ("wrong", "fail", "lose", "bad", "hurry"), duplicates. The agent reviews the flagged items and fixes what's clearly wrong. Then the owner does a human pass (👤): the README explains how to mark lines for change.
- **Acceptance:**
  - [ ] Automated pass clean or every remaining flag justified in the README.
  - [ ] Owner sign-off recorded in `docs/progress.md`.

### M6-09 Docs and release
- **Size/Tier:** M / C · **Review:** optional
- **Depends on:** M6-01 … M6-08, M6-10
- **PLAN refs:** Phase 6, `README.md` §8.13
- **Owns:** `README.md`, `docs/screenshots/*`, `CHANGELOG.md`, `deploy/README.md` (final pass), `.github/workflows/release.yml`
- **Spec:** README with what it is, screenshots/GIFs (captured by Playwright in CI), how to run locally, how to self-host (link to `deploy/README.md`), privacy statement, credits (fonts with licenses), the IP disclaimer. `release.yml`: on tag `v*`, generate release notes from the squash-merged PR titles since the previous tag and create a GitHub Release with the `dist/` zip attached. Version `1.0.0`. Re-check the Proxmox guide end to end against the final image (HTTPS, offline, update toast after Watchtower pulls a new `:stable`).
- **Acceptance:**
  - [ ] A fresh clone builds; the `:v1.0.0` image runs on the owner's Proxmox host over HTTPS and plays offline after first load (👤 confirms on a kid's device).

### M6-10 Performance and budget tests in CI
- **Size/Tier:** M / B · **Review:** optional · **E2E:** yes
- **Depends on:** M6-03, M6-04, M6-05
- **PLAN refs:** §6.4, §9.6, Phase 6 accept
- **Owns:** `tests/e2e/perf/*.spec.ts`, `tools/lighthouse.ts`, `.github/workflows/nightly.yml` (perf section), `.github/workflows/ci.yml` (`perf` job)
- **Spec:** CDP CPU throttling 4×; measure p95 frame time over 20 s in Mine, Defense (max wave) and Builder; draw calls; TTI. Lighthouse (Node API, desktop preset) performance ≥ 90. Runs nightly and on pushes to `main`, plus on PRs labelled `perf` or touching `src/render/**`; posts the numbers to the job summary and compares with the last `main` run (fail on > 15% regression).
- **Acceptance:**
  - [ ] Budgets met per `contracts.md` §14 and `README.md` §8.6–8.7.

### M6-11 Deferred: classroom report
- **Status:** deferred by the owner (`README.md` §8.14). Not part of v1. Do not start it unless the owner asks.
- Cut entirely: extra keyboard layouts, tablet/touch input, async ghost runs.
- If revived: a teacher-facing summary across all local profiles. If it becomes part of a product for schools, start with a design proposal (accounts, sync, school privacy requirements), because those change `PLAN.md` §6.7 and §11.

### M6-GATE (release)
`PLAN.md` Phase 6 acceptance (with the Lighthouse PWA correction in `README.md` §8.6), owner sign-off on content (M6-08) and a final 👤 play session across bands. Tag `v1.0.0`.
