/**
 * Cube particles on screen (task M2-05): one pooled `InstancedMesh` of at most 512 small cubes, so
 * any number of bursts costs one draw call.
 *
 * Each cube samples a 4×4-texel square of its block's atlas tile through a per-instance `iUv`
 * attribute (a small patch of the Lambert vertex shader), so chips look like bits of the block.
 * The atlas texture is the scene's own (M2-01); this module never clones or disposes it.
 */
import * as THREE from "three";
import type { ParticlePool } from "./particle-pool";

export interface ParticleMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshLambertMaterial;
  /** Uses `texture` as the map (null before the first atlas). Recompiles only when it appears. */
  setTexture(texture: THREE.Texture | null): void;
  /** Copies the pool into the instance buffers. Allocates nothing. */
  sync(pool: ParticlePool): void;
  dispose(): void;
}

const PROGRAM_KEY = "vt-fx-particles";
/** The color of untextured chips (before an atlas exists): a soft stone grey. */
const UNTEXTURED = 0xb8b0a4;

export function createParticleMesh(pool: ParticlePool): ParticleMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  // The pool's own array backs the attribute, so swaps in the pool need no copy here.
  const iUv = new THREE.InstancedBufferAttribute(pool.uv, 4);
  iUv.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("iUv", iUv);

  const material = new THREE.MeshLambertMaterial({ color: UNTEXTURED });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <uv_pars_vertex>", "#include <uv_pars_vertex>\nattribute vec4 iUv;")
      .replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = iUv.xy + uv * iUv.zw;\n#endif",
      );
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;

  const mesh = new THREE.InstancedMesh(geometry, material, pool.max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  // The particles move every frame; a stale bounding sphere would cull live ones.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = "fx-particles";

  // Reused per frame.
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();

  return {
    mesh,
    material,
    setTexture(texture) {
      if (material.map === texture) return;
      const recompile = (material.map === null) !== (texture === null);
      material.map = texture;
      material.color.set(texture ? 0xffffff : UNTEXTURED);
      if (recompile) material.needsUpdate = true;
    },
    sync(pl) {
      const n = pl.alive;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        p.set(pl.pos[k] ?? 0, pl.pos[k + 1] ?? 0, pl.pos[k + 2] ?? 0);
        e.set(pl.rot[k] ?? 0, pl.rot[k + 1] ?? 0, pl.rot[k + 2] ?? 0);
        q.setFromEuler(e);
        const sc = pl.scaleOf(i);
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0) mesh.instanceMatrix.needsUpdate = true;
      if (pl.takeUvDirty()) iUv.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
