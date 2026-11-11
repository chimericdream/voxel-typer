# Texture overrides

Every block texture is painted in code at startup (`src/render/atlas/`). A PNG in this folder
replaces one painted tile.

- **Name:** `<blockId>_<face>.png`, where `face` is `top`, `side` or `bottom`. For example
  `oak-log_top.png`. Block ids are kebab-case, as in `src/content/blocks/`.
- **Size:** exactly 16 × 16 pixels, RGBA. Other sizes are skipped with a console warning.
- **Look:** flat pixel art with hard edges, using the block's palette ramp
  (`src/render/atlas/palettes.ts`). A hand-drawn tile doesn't follow biome palette shifts.
- **Originality:** draw it yourself. Never copy, trace or recolor a texture from another game
  (`CLAUDE.md`, IP rule). Name nothing after another game.

The build picks the files up with `import.meta.glob` (see `buildAtlas` in
`src/render/atlas/build.ts`), so adding one needs no code change. Check the result at
`/atlas.html` in `npm run dev`.
