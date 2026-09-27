/// トレイト定義。**Fuse.sol の traitsOf() と完全に一致させること。**
/// ビットシフトや配列長がずれると、チェーン上の属性と表示が食い違う。
///
/// レアリティは意図的に作っていない。どの値も均等確率で、優劣はない。

export type Family = "creature" | "sushi" | "engimono";

export type Base = { name: string; family: Family; motif: string };

/// 13 + 13 + 13 = 39。縁起物は「作られた物」で揃えてある。
/// 狐や鶴のような生き物を入れるとCreatureと見分けがつかなくなるため。
export const BASES: readonly Base[] = [
  // --- Creature 13 ---
  { family: "creature", name: "Mochi Bun", motif: "a round fluffy bunny-like creature with long drooping ears" },
  { family: "creature", name: "Ember Cat", motif: "a small cat-like creature with a curled flame-shaped tail" },
  { family: "creature", name: "Puff Chick", motif: "a chubby bird-like creature with tiny stubby wings and a tuft crest" },
  { family: "creature", name: "Leaf Slime", motif: "a soft slime-like creature with two little leaf sprouts on top" },
  { family: "creature", name: "Fluff Fox", motif: "a pudgy fox-like creature with a big bushy tail and pointed ears" },
  { family: "creature", name: "Pearl Draco", motif: "a tiny dragon-like creature with rounded horns and a pearl on its chest" },
  { family: "creature", name: "Bubble Otter", motif: "a round otter-like creature with a shiny bubble balanced on its nose" },
  { family: "creature", name: "Star Moth", motif: "a plump moth-like creature with rounded wings covered in star patterns" },
  { family: "creature", name: "Snow Bear", motif: "a small bear-like creature with fluffy snow-tuft ears and a stubby tail" },
  { family: "creature", name: "Coral Axolotl", motif: "an axolotl-like creature with frilly coral-shaped gills on both sides of its head" },
  { family: "creature", name: "Pebble Turtle", motif: "a squat turtle-like creature with a smooth rounded shell covered in soft moss" },
  { family: "creature", name: "Honey Bee", motif: "a chubby bee-like creature with tiny round wings and a striped fuzzy body" },
  { family: "creature", name: "Cloud Sheep", motif: "a sheep-like creature whose fleece is shaped like a soft puffy cloud" },

  // --- Sushi 13 ---
  { family: "sushi", name: "Tuna Nigiri", motif: "a piece of tuna nigiri sushi, one slice of lean red tuna draped over a rounded pillow of rice" },
  { family: "sushi", name: "Salmon Nigiri", motif: "a piece of salmon nigiri sushi, a pale orange salmon slice with soft white marbling over a rice pillow" },
  { family: "sushi", name: "Tamago Nigiri", motif: "a piece of tamago nigiri sushi, a thick pale yellow sweet omelette block on rice, belted with a strip of dark seaweed" },
  { family: "sushi", name: "Ebi Nigiri", motif: "a piece of shrimp nigiri sushi, a butterflied pink and white prawn with a striped tail over rice" },
  { family: "sushi", name: "Tako Nigiri", motif: "a piece of octopus nigiri sushi, a scalloped pale purple octopus slice over rice" },
  { family: "sushi", name: "Ikura Gunkan", motif: "a gunkan-maki sushi cup wrapped in dark seaweed, heaped with glossy round orange salmon roe" },
  { family: "sushi", name: "Uni Gunkan", motif: "a gunkan-maki sushi cup wrapped in dark seaweed, filled with soft golden sea urchin lobes" },
  { family: "sushi", name: "Kappa Maki", motif: "a round cucumber maki roll seen end-on, a pale green cucumber core in white rice inside a dark seaweed ring" },
  { family: "sushi", name: "Tekka Maki", motif: "a round tuna maki roll seen end-on, a red tuna core in white rice inside a dark seaweed ring" },
  { family: "sushi", name: "California Roll", motif: "a round inside-out roll seen end-on, rice on the outside dotted with orange roe, avocado and crab inside" },
  { family: "sushi", name: "Inari Zushi", motif: "a piece of inari sushi, a plump golden-brown fried tofu pouch folded over rice" },
  { family: "sushi", name: "Temaki Cone", motif: "a hand-rolled temaki sushi cone of dark seaweed with rice and fillings peeking out of the wide top" },
  { family: "sushi", name: "Onigiri", motif: "a rounded triangular rice ball with a wide band of dark seaweed across its base" },

  // --- Engimono 13（すべて「作られた物」） ---
  { family: "engimono", name: "Daruma", motif: "a round red daruma doll with a white face, thick painted eyebrows and a weighted rocking base" },
  { family: "engimono", name: "Maneki Neko", motif: "a glazed ceramic beckoning cat figurine with one raised paw, a red collar and a gold bell" },
  { family: "engimono", name: "Kokeshi", motif: "a small turned wooden kokeshi doll, a cylindrical body with a round head and painted bob hair" },
  { family: "engimono", name: "Omamori", motif: "a small brocade amulet pouch tied shut with a silk cord and tassel" },
  { family: "engimono", name: "Torii", motif: "a tiny vermilion torii gate, two pillars under a curved crossbeam" },
  { family: "engimono", name: "Ema", motif: "a pentagonal wooden ema plaque hung on a cord, with a painted border" },
  { family: "engimono", name: "Suzu Bell", motif: "a round gold shrine bell with a slit mouth and a thick braided rope" },
  { family: "engimono", name: "Hyoutan", motif: "a polished double-bulb gourd flask with a small corked neck and a cord" },
  { family: "engimono", name: "Kadomatsu", motif: "a new year kadomatsu arrangement, cut bamboo stalks bound with rope beside pine sprigs" },
  { family: "engimono", name: "Shishimai", motif: "a lacquered lion dance head with a red face, gold teeth and a green patterned cloth mane" },
  { family: "engimono", name: "Shigaraki Tanuki", motif: "a glazed ceramic tanuki figurine wearing a wide straw hat and holding a small sake flask" },
  { family: "engimono", name: "Koinobori", motif: "a cloth carp streamer windsock with round eyes and layered scale patterns" },
  { family: "engimono", name: "Fuurin", motif: "a clear glass wind chime bell with a painted rim and a paper strip hanging below" },
] as const;

/// 以下4軸は Fuse.sol の traitsOf() と同じ順序・同じ長さでなければならない。
export const MOODS = ["Sleepy", "Curious", "Cheerful", "Calm", "Surprised"] as const;
export const ACCENTS = ["Lilac", "Mint", "Peach", "Butter", "Sky", "Cream"] as const;
/// 小さすぎるとAIが描き落とすので、はっきり見えるものだけにしてある。
export const CHARMS = [
  "Sparkle",
  "Ribbon",
  "Star Cheek",
  "Cloud Tail",
  "Flower Crown",
  "Tiny Hat",
  "Blush",
  "Halo",
] as const;
export const POSES = ["Sitting", "Standing", "Hopping", "Curled", "Leaning"] as const;

export type TraitIndexes = { mood: number; accent: number; charm: number; pose: number };

/// Fuse.sol traitsOf() と同じ計算。ビットシフトを変えるときは両方直すこと。
export function traitsFromSeed(seed: bigint): TraitIndexes {
  return {
    mood: Number((seed >> 16n) % BigInt(MOODS.length)),
    accent: Number((seed >> 32n) % BigInt(ACCENTS.length)),
    charm: Number((seed >> 48n) % BigInt(CHARMS.length)),
    pose: Number((seed >> 64n) % BigInt(POSES.length)),
  };
}

/// Fuse.sol umamiOf() と同じ計算。
export function umamiFromSeed(seed: bigint): number {
  return Number(1n + (seed % 100n));
}

export const FAMILY_INDEX: Record<Family, number> = { creature: 0, sushi: 1, engimono: 2 };
