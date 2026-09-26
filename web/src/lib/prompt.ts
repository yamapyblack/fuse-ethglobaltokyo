/// 描き方は全素材・全世代で固定。パレットだけ被写体に合わせて差し替える。
/// 寿司まで薄紫にすると寿司に見えなくなるので、そこだけ分けている。
const STYLE_BASE =
  "Style: kawaii chibi mascot illustration, soft rounded shapes, thick gentle outlines, " +
  "flat shading with light pastel gradients, one single subject centered in frame, " +
  "plain off-white background, sticker-like clean edges, " +
  "no text, no watermark, no border, no collage, no split panels.";

const CREATURE_PALETTE = "Palette: pastel lavender and white.";

/// 背景指定はプロンプトの最後に置く。パレットより前に書くと、寿司の暖色が
/// 背景まで塗られて暗いグラデーションになった（13枚中7枚）。
const BACKGROUND =
  "The background must be one flat off-white tone (#FAF7F2), the same for every image in this set. " +
  "No dark background, no coloured gradient, no vignette, no glow, no scene, no table surface.";

const SUSHI_PALETTE =
  "Palette: soft pastel food colours kept light and desaturated so it sits in the same set as " +
  "the pastel creatures — cream white rice, muted salmon pink, pale coral red, soft dark seaweed green.";

/// 子は親2体の色を受け継ぐ。生き物と寿司が混ざるので、被写体の種類は決め打ちしない。
const CHILD_PALETTE = "Palette: pastel, blended from the colours of the two parents.";

const FUSION =
  "You are given two reference images: parent A and parent B. " +
  "Each parent is either a small creature or a piece of sushi. " +
  "Design ONE brand-new character that fuses both parents into a single coherent design. " +
  "Merge their silhouette, their distinctive parts (ears, horns, fins, rice base, seaweed wrap, toppings) " +
  "and their colour accents so the result reads as one creature born from the two, " +
  "not as two objects placed together. Do not place the parents side by side.";

/// label はNFTのattributesに出す短い名前、text は画像生成に渡す指示。
type Option = { label: string; text: string };

const DOMINANCE: readonly Option[] = [
  { label: "A-dominant", text: "Parent A leads the overall silhouette; parent B contributes the color accents and markings." },
  { label: "B-dominant", text: "Parent B leads the overall silhouette; parent A contributes the color accents and markings." },
  { label: "Even", text: "Balance both parents evenly, roughly half and half." },
  { label: "A-head", text: "Take the head from parent A and the body proportions from parent B." },
  { label: "B-head", text: "Take the head from parent B and the body proportions from parent A." },
];

const ACCENT: readonly Option[] = [
  { label: "Lilac", text: "soft lilac accents" },
  { label: "Mint", text: "pale mint accents" },
  { label: "Peach", text: "peach pink accents" },
  { label: "Butter", text: "butter yellow accents" },
  { label: "Sky", text: "sky blue accents" },
  { label: "Cream", text: "cream beige accents" },
];

const CHARM: readonly Option[] = [
  { label: "Sparkle", text: "a tiny floating sparkle above its head" },
  { label: "Ribbon", text: "a small ribbon on one ear" },
  { label: "Star Cheek", text: "a little star-shaped marking on the cheek" },
  { label: "Cloud Tail", text: "a fluffy cloud-like tail tuft" },
  { label: "Jelly Ears", text: "translucent jelly-like tips on its ears" },
  { label: "Gem Back", text: "a pair of tiny gem studs along its back" },
  { label: "Blush", text: "a soft gradient blush on both cheeks" },
  { label: "Crescent", text: "a small crescent marking on the forehead" },
];

const EXPRESSION: readonly Option[] = [
  { label: "Sleepy", text: "a gentle sleepy smile" },
  { label: "Curious", text: "wide curious eyes" },
  { label: "Cheerful", text: "a cheerful open-mouth grin" },
  { label: "Calm", text: "a calm closed-eye smile" },
  { label: "Surprised", text: "a slightly surprised look" },
];

const POSE: readonly Option[] = [
  { label: "Sitting", text: "sitting down with both front paws together" },
  { label: "Standing", text: "standing upright, tail curled" },
  { label: "Hopping", text: "mid-hop, ears lifted" },
  { label: "Curled", text: "curled up in a soft round shape" },
  { label: "Leaning", text: "leaning forward, one paw raised" },
];

export type FusionTraits = {
  dominance: Option;
  accent: Option;
  charm: Option;
  expression: Option;
  pose: Option;
};

/// seedのビットを切り出して配合条件を決める。同じseedなら必ず同じ条件になる。
export function traitsFromSeed(seed: bigint): FusionTraits {
  const pick = (arr: readonly Option[], shift: bigint) => arr[Number((seed >> shift) % BigInt(arr.length))];
  return {
    dominance: pick(DOMINANCE, 0n),
    accent: pick(ACCENT, 16n),
    charm: pick(CHARM, 32n),
    expression: pick(EXPRESSION, 48n),
    pose: pick(POSE, 64n),
  };
}

export function buildPrompt(seed: bigint): { prompt: string; traits: FusionTraits } {
  const traits = traitsFromSeed(seed);
  const prompt = [
    FUSION,
    `Fusion condition: ${traits.dominance.text}`,
    `Give the new character ${traits.accent.text}, ${traits.charm.text}, ${traits.expression.text}, ${traits.pose.text}.`,
    STYLE_BASE,
    CHILD_PALETTE,
    BACKGROUND,
  ].join("\n");
  return { prompt, traits };
}

/// 初期素材用。親がいないので単体で描かせる。
export function buildMaterialPrompt(index: number, motif: string, kind: MaterialKind): string {
  return [
    `Design subject #${index}: ${motif}.`,
    "It will later be fused with another subject from this set, so keep the silhouette simple and readable.",
    STYLE_BASE,
    kind === "sushi" ? SUSHI_PALETTE : CREATURE_PALETTE,
    BACKGROUND,
  ].join("\n");
}

/// 初期素材26体。生き物13 + 寿司13。
/// 半分を寿司にしているのは、生き物どうしだと配合結果が「合体した」ように見えないため。
/// 生き物×寿司なら一目で分かる。
export type MaterialKind = "creature" | "sushi";

export const MATERIALS: readonly { name: string; motif: string; kind: MaterialKind }[] = [
  { kind: "creature", name: "Mochi Bun", motif: "a round fluffy bunny-like creature with long drooping ears" },
  { kind: "creature", name: "Ember Cat", motif: "a small cat-like creature with a curled flame-shaped tail" },
  { kind: "creature", name: "Puff Chick", motif: "a chubby bird-like creature with tiny stubby wings and a tuft crest" },
  { kind: "creature", name: "Leaf Slime", motif: "a soft slime-like creature with two little leaf sprouts on top" },
  { kind: "creature", name: "Fluff Fox", motif: "a pudgy fox-like creature with a big bushy tail and pointed ears" },
  { kind: "creature", name: "Pearl Draco", motif: "a tiny dragon-like creature with rounded horns and a pearl on its chest" },
  { kind: "creature", name: "Bubble Otter", motif: "a round otter-like creature with a shiny bubble balanced on its nose" },
  { kind: "creature", name: "Star Moth", motif: "a plump moth-like creature with rounded wings covered in star patterns" },
  { kind: "creature", name: "Snow Bear", motif: "a small bear-like creature with fluffy snow-tuft ears and a stubby tail" },
  { kind: "creature", name: "Coral Axolotl", motif: "an axolotl-like creature with frilly coral-shaped gills on both sides of its head" },
  { kind: "creature", name: "Pebble Turtle", motif: "a squat turtle-like creature with a smooth rounded shell covered in soft moss" },
  { kind: "creature", name: "Honey Bee", motif: "a chubby bee-like creature with tiny round wings and a striped fuzzy body" },
  { kind: "creature", name: "Cloud Sheep", motif: "a sheep-like creature whose fleece is shaped like a soft puffy cloud" },

  { kind: "sushi", name: "Tuna Nigiri", motif: "a piece of tuna nigiri sushi, one slice of lean red tuna draped over a rounded pillow of rice" },
  { kind: "sushi", name: "Salmon Nigiri", motif: "a piece of salmon nigiri sushi, a pale orange salmon slice with soft white marbling over a rice pillow" },
  { kind: "sushi", name: "Tamago Nigiri", motif: "a piece of tamago nigiri sushi, a thick pale yellow sweet omelette block on rice, belted with a strip of dark seaweed" },
  { kind: "sushi", name: "Ebi Nigiri", motif: "a piece of shrimp nigiri sushi, a butterflied pink and white prawn with a striped tail over rice" },
  { kind: "sushi", name: "Tako Nigiri", motif: "a piece of octopus nigiri sushi, a scalloped pale purple octopus slice over rice" },
  { kind: "sushi", name: "Ikura Gunkan", motif: "a gunkan-maki sushi cup wrapped in dark seaweed, heaped with glossy round orange salmon roe" },
  { kind: "sushi", name: "Uni Gunkan", motif: "a gunkan-maki sushi cup wrapped in dark seaweed, filled with soft golden sea urchin lobes" },
  { kind: "sushi", name: "Kappa Maki", motif: "a round cucumber maki roll seen end-on, a pale green cucumber core in white rice inside a dark seaweed ring" },
  { kind: "sushi", name: "Tekka Maki", motif: "a round tuna maki roll seen end-on, a red tuna core in white rice inside a dark seaweed ring" },
  { kind: "sushi", name: "California Roll", motif: "a round inside-out roll seen end-on, rice on the outside dotted with orange roe, avocado and crab inside" },
  { kind: "sushi", name: "Inari Zushi", motif: "a piece of inari sushi, a plump golden-brown fried tofu pouch folded over rice" },
  { kind: "sushi", name: "Temaki Cone", motif: "a hand-rolled temaki sushi cone of dark seaweed with rice and fillings peeking out of the wide top" },
  { kind: "sushi", name: "Onigiri", motif: "a rounded triangular rice ball with a wide band of dark seaweed across its base" },
] as const;
