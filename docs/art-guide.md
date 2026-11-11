# Art guide

This is a stub. The art-direction tasks fill it in as they make choices (M1-14 palette and atlas,
M2-01 to M2-05 render and FX, M4-03 mobs, M5-03 bosses, M5-07 biomes 5–9). Until then, `PLAN.md` §5
is the art direction.

## Fixed so far

- **Original art only.** No Mojang/Microsoft textures, mobs, characters, fonts or sounds, and nothing
  that looks like a copy of them (`PLAN.md` §1, `docs/impl/README.md` §4.5).
- **Voxel everything.** The world, UI, particles, mobs, fonts and cursor are made of cubes or
  pixel-grid art (`PLAN.md` §1, pillar 3).
- **Textures are generated in code.** A 16×16 pixel atlas is painted at startup from seeded noise and
  palette ramps and sampled with `NearestFilter`. Hand-drawn PNG overrides may replace any tile later
  (`PLAN.md` §5.1).
- **Palettes are data,** one per biome: warm by day, cool at night.
- **Text stays readable.** Text over the 3D scene sits on a semi-opaque plate and meets WCAG AA
  contrast.
- **Lighting:** vertex ambient occlusion on voxels, one directional sun plus a hemisphere light,
  point lights for lanterns, and a simple shadow map on medium quality and up.
- **Models** (mobs, avatar, pets, bosses) are JSON voxel models made of box parts with idle, walk,
  hit and defeat animations (`docs/impl/contracts.md` §8.4).

## To be written

- Palette ramps per biome, with swatches
- Tile recipes and how to add one
- Voxel model proportions and the mob silhouette rules
- UI kit: bevels, 9-slice borders, button states
- FX and particles
- The visual review checklist (`docs/impl/README.md` §5.3)
