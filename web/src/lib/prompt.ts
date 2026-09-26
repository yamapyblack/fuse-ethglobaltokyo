/// 画風は固定。seedで振れるのは配合条件だけにして、コレクションの見た目を揃える。
const STYLE =
  "Style: kawaii chibi mascot creature illustration, soft rounded shapes, thick gentle outlines, " +
  "flat shading with light pastel gradients, pastel lavender and white palette, " +
  "one single full-body character centered in frame, plain off-white background, " +
  "sticker-like clean edges, no text, no watermark, no border, no collage, no split panels.";

const FUSION =
  "You are given two reference creature images: parent A and parent B. " +
  "Design ONE brand-new creature that fuses both parents. " +
  "Merge their silhouette, ear and horn shapes, color accents and body markings into a single coherent character " +
  "that reads as a believable offspring of the two. Do not place the parents side by side.";

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
    `Give the new creature ${traits.accent.text}, ${traits.charm.text}, ${traits.expression.text}, ${traits.pose.text}.`,
    STYLE,
  ].join("\n");
  return { prompt, traits };
}

/// 初期素材用。親がいないので単体で描かせる。
export function buildMaterialPrompt(index: number, motif: string): string {
  return [
    `Design creature #${index}: ${motif}.`,
    "It is a mascot that will later be fused with other creatures, so keep the silhouette simple and readable.",
    STYLE,
  ].join("\n");
}

/// 初期素材6体のモチーフ。画風は共通、シルエットだけ違えて配合の差が出るようにする。
export const MATERIALS = [
  { name: "Mochi Bun", motif: "a round fluffy bunny-like creature with long drooping ears" },
  { name: "Ember Cat", motif: "a small cat-like creature with a curled flame-shaped tail" },
  { name: "Puff Chick", motif: "a chubby bird-like creature with tiny stubby wings and a tuft crest" },
  { name: "Leaf Slime", motif: "a soft slime-like creature with two little leaf sprouts on top" },
  { name: "Fluff Fox", motif: "a pudgy fox-like creature with a big bushy tail and pointed ears" },
  { name: "Pearl Draco", motif: "a tiny dragon-like creature with rounded horns and a pearl on its chest" },
  { name: "Bubble Otter", motif: "a round otter-like creature with a shiny bubble balanced on its nose" },
  { name: "Star Moth", motif: "a plump moth-like creature with rounded wings covered in star patterns" },
  { name: "Snow Bear", motif: "a small bear-like creature with fluffy snow-tuft ears and a stubby tail" },
  { name: "Coral Axolotl", motif: "an axolotl-like creature with frilly coral-shaped gills on both sides of its head" },
  { name: "Pebble Turtle", motif: "a squat turtle-like creature with a smooth rounded shell covered in soft moss" },
  { name: "Honey Bee", motif: "a chubby bee-like creature with tiny round wings and a striped fuzzy body" },
  { name: "Cloud Sheep", motif: "a sheep-like creature whose fleece is shaped like a soft puffy cloud" },
  { name: "Mush Frog", motif: "a round frog-like creature with a domed mushroom cap growing on its head" },
  { name: "Ink Squid", motif: "a small squid-like creature with short curled tentacles and a pointed mantle" },
  { name: "Candy Deer", motif: "a tiny fawn-like creature with swirled candy-stick antlers" },
  { name: "Lantern Fish", motif: "a round fish-like creature with a glowing lantern bulb on a stalk above its head" },
  { name: "Cactus Mouse", motif: "a mouse-like creature with a rounded cactus growing along its back" },
  { name: "Prism Bat", motif: "a small bat-like creature with translucent prism wings and big round ears" },
  { name: "Ribbon Snake", motif: "a coiled snake-like creature whose body is flat and soft like a ribbon" },
  { name: "Acorn Squirrel", motif: "a squirrel-like creature with an acorn-shaped tail and round cheeks" },
  { name: "Thunder Pup", motif: "a puppy-like creature with zigzag lightning-shaped ears" },
  { name: "Peach Piglet", motif: "a piglet-like creature with a peach-shaped body and a tiny curled tail" },
  { name: "Mirror Owl", motif: "an owl-like creature with oversized round mirror-like eyes and a flat face" },
  { name: "Glacier Penguin", motif: "a penguin-like creature with an icy crystal crest on its head" },
  { name: "Ember Lion", motif: "a lion cub-like creature with a soft flame-shaped mane" },
] as const;
