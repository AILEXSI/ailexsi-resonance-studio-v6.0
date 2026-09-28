/**
 * Authoritative VIS scene registry / metadata.
 * UI (Inspector + VIS-track browser), cycle order, short names, and suite/family
 * navigation all derive from SCENE_CATALOG. Do not hardcode a second dropdown.
 *
 * Future hooks (intentionally unused now): thumbnail, favorite, search tokens.
 */

export const VIS_BROWSER_CATEGORIES = ["ALL", "LEXI", "CLASSIC"] as const;
export type VisBrowserCategory = (typeof VIS_BROWSER_CATEGORIES)[number];

export const VIS_SUITES = ["LEXI", "CLASSIC"] as const;
export type VisSuiteId = (typeof VIS_SUITES)[number];

export const LEXI_FAMILIES = ["FLOW", "GEOMETRY", "SYNTHWAVE", "PARTICLE", "STAGE"] as const;
export type LexiFamilyId = (typeof LEXI_FAMILIES)[number];

export const CLASSIC_FAMILIES = ["CORE", "FIELD", "FORM"] as const;
export type ClassicFamilyId = (typeof CLASSIC_FAMILIES)[number];

export type VisFamilyId = LexiFamilyId | ClassicFamilyId;

export interface SceneCatalogEntry {
  id: string;
  displayName: string;
  shortName: string;
  suite: VisSuiteId;
  family: VisFamilyId;
  description: string;
  renderer: string;
  /** Reserved — do not treat missing as a dead-end. */
  thumbnail?: string;
  /** Reserved — do not treat missing as a dead-end. */
  favorite?: boolean;
  /** Reserved search tokens for a later filter box. */
  search?: string;
}

export const SCENE_CATALOG = [
  {
    id: "spectrum-bars",
    displayName: "Spectrum Bars",
    shortName: "Bars",
    suite: "CLASSIC",
    family: "CORE",
    description: "Mirrored modern frequency bars",
    renderer: "spectrum-bars",
  },
  {
    id: "pulse-orb",
    displayName: "Pulse Orb",
    shortName: "Orb",
    suite: "CLASSIC",
    family: "CORE",
    description: "Centered orb with reactive pulse",
    renderer: "pulse-orb",
  },
  {
    id: "aurora-veil",
    displayName: "Aurora Veil",
    shortName: "Aurora",
    suite: "CLASSIC",
    family: "FIELD",
    description: "Soft aurora curtains",
    renderer: "aurora-veil",
  },
  {
    id: "star-bloom",
    displayName: "Star Bloom",
    shortName: "Stars",
    suite: "CLASSIC",
    family: "FIELD",
    description: "Blooming star field",
    renderer: "star-bloom",
  },
  {
    id: "liquid-gold",
    displayName: "Liquid Gold",
    shortName: "Gold",
    suite: "CLASSIC",
    family: "FORM",
    description: "Flowing metallic gold",
    renderer: "liquid-gold",
  },
  {
    id: "kaleido-hex",
    displayName: "Kaleido Hex",
    shortName: "Kaleido",
    suite: "CLASSIC",
    family: "CORE",
    description: "Hexagonal kaleidoscope",
    renderer: "kaleido-hex",
  },
  {
    id: "sun-core",
    displayName: "Sun Core",
    shortName: "Sun",
    suite: "CLASSIC",
    family: "CORE",
    description: "Radiating solar core",
    renderer: "sun-core",
  },
  {
    id: "ember-rain",
    displayName: "Ember Rain",
    shortName: "Ember",
    suite: "CLASSIC",
    family: "FIELD",
    description: "Falling ember particles",
    renderer: "ember-rain",
  },
  {
    id: "particle-field",
    displayName: "Particle Field",
    shortName: "Field",
    suite: "CLASSIC",
    family: "FIELD",
    description: "Lightweight reactive particles",
    renderer: "particle-field",
  },
  {
    id: "resonance-wave",
    displayName: "Resonance Wave",
    shortName: "Wave",
    suite: "CLASSIC",
    family: "FORM",
    description: "Central orb and expanding rings",
    renderer: "resonance-wave",
  },
  {
    id: "resonance-dunes",
    displayName: "Resonance Dunes",
    shortName: "Dunes",
    suite: "CLASSIC",
    family: "FORM",
    description: "Generative golden particle landscape bound to spectrum and rhythm",
    renderer: "resonance-dunes",
  },
  {
    id: "tunnel-spiral",
    displayName: "Tunnel Spiral",
    shortName: "Tunnel",
    suite: "CLASSIC",
    family: "FORM",
    description: "Spiral tunnel fly-through",
    renderer: "tunnel-spiral",
  },
  {
    id: "lita-bloom",
    displayName: "Lita Bloom",
    shortName: "Bloom",
    suite: "CLASSIC",
    family: "FORM",
    description: "Soft luminous bloom",
    renderer: "lita-bloom",
  },
  {
    id: "void-lattice",
    displayName: "Void Lattice",
    shortName: "Lattice",
    suite: "CLASSIC",
    family: "FORM",
    description: "Infinite 3D lattice the camera flies through",
    renderer: "void-lattice",
  },
  {
    id: "nebula-helix",
    displayName: "Nebula Helix",
    shortName: "Helix",
    suite: "CLASSIC",
    family: "FIELD",
    description: "Double helix of light",
    renderer: "nebula-helix",
  },
  {
    id: "accretion-disk",
    displayName: "Accretion Disk",
    shortName: "Disk",
    suite: "CLASSIC",
    family: "FORM",
    description: "Dark core and orbiting disk",
    renderer: "accretion-disk",
  },
  {
    id: "crystal-storm",
    displayName: "Crystal Storm",
    shortName: "Crystal",
    suite: "CLASSIC",
    family: "FORM",
    description: "Crystalline storm shards",
    renderer: "crystal-storm",
  },
  {
    id: "lexi",
    displayName: "LEXI",
    shortName: "LEXI",
    suite: "LEXI",
    family: "FLOW",
    description: "Flagship FLOW — cinematic energy landscape (quality pass on ref-level dunes)",
    renderer: "lexi",
  },
  {
    id: "lexi-ref",
    displayName: "LEXI Ref-Level",
    shortName: "LEXI Ref",
    suite: "LEXI",
    family: "FLOW",
    description: "PR #31 reference-level particle dunes — exact retained snapshot",
    renderer: "lexi-ref",
  },
  {
    id: "lexi-2036",
    displayName: "LEXI 2036",
    shortName: "LEXI 2036",
    suite: "LEXI",
    family: "FLOW",
    description: "PR #30 cinematic future energy space — luminous stream and atmosphere",
    renderer: "lexi-2036",
  },
  {
    id: "lexi-v3",
    displayName: "LEXI V3 Depth",
    shortName: "LEXI V3",
    suite: "LEXI",
    family: "FLOW",
    description: "PR #29 cinematic depth — vanishing terrain and kick pressure",
    renderer: "lexi-v3",
  },
  {
    id: "lexi-v2",
    displayName: "LEXI Flow V2",
    shortName: "LEXI V2",
    suite: "LEXI",
    family: "FLOW",
    description: "PR #28 polish V2 flagship look — same paint as Minimal Horizon, kept as its own id",
    renderer: "lexi-v2",
  },
  {
    id: "lexi-minimal",
    displayName: "LEXI Minimal Horizon",
    shortName: "LEXI Min",
    suite: "LEXI",
    family: "FLOW",
    description: "Quiet parallel-horizon variant of V2 — calm gold sea",
    renderer: "lexi-minimal",
  },
  {
    id: "lexi-v1",
    displayName: "LEXI Flow V1",
    shortName: "LEXI V1",
    suite: "LEXI",
    family: "FLOW",
    description: "PR #27 original horizon flow — gold energy line and receding mesh",
    renderer: "lexi-v1",
  },
] as const satisfies readonly SceneCatalogEntry[];

export type VisualizerSceneId = (typeof SCENE_CATALOG)[number]["id"];
export const VISUALIZER_SCENE_IDS = SCENE_CATALOG.map((entry) => entry.id) as readonly VisualizerSceneId[];

export const LEXI_SCENE_IDS = SCENE_CATALOG.filter((entry) => entry.suite === "LEXI").map(
  (entry) => entry.id,
) as readonly VisualizerSceneId[];

const BY_ID = new Map<string, (typeof SCENE_CATALOG)[number]>(SCENE_CATALOG.map((entry) => [entry.id, entry]));

export function getCatalogEntry(id: string): (typeof SCENE_CATALOG)[number] | undefined {
  return BY_ID.get(id);
}

export function sceneShortNameFromCatalog(id: string): string {
  return BY_ID.get(id)?.shortName ?? id;
}

export function isVisualizerSceneId(value: unknown): value is VisualizerSceneId {
  return typeof value === "string" && BY_ID.has(value);
}

export function catalogFamiliesFor(suite: VisSuiteId): readonly string[] {
  return suite === "LEXI" ? LEXI_FAMILIES : CLASSIC_FAMILIES;
}

export function catalogEntriesFor(opts: {
  category?: VisBrowserCategory;
  suite?: VisSuiteId;
  family?: string;
}): readonly (typeof SCENE_CATALOG)[number][] {
  const category = opts.category ?? "ALL";
  return SCENE_CATALOG.filter((entry) => {
    if (category === "LEXI" && entry.suite !== "LEXI") return false;
    if (category === "CLASSIC" && entry.suite !== "CLASSIC") return false;
    if (opts.suite && entry.suite !== opts.suite) return false;
    if (opts.family && entry.family !== opts.family) return false;
    return true;
  });
}

export function lexiFamilyOf(id: string): LexiFamilyId | undefined {
  const entry = BY_ID.get(id);
  if (!entry || entry.suite !== "LEXI") return undefined;
  return entry.family as LexiFamilyId;
}
