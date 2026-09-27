import { ACCENTS, BASES, CHARMS, MOODS, POSES, traitsFromSeed, type Family } from "./traits";

/// 描き方は全世代で固定。パレットだけ被写体に合わせて差し替える。
/// 全部を薄紫にすると寿司も縁起物もそれと分からなくなるため。
const STYLE_BASE =
  "Style: kawaii chibi mascot illustration, soft rounded shapes, thick gentle outlines, " +
  "flat shading with light pastel gradients, one single subject centered in frame, " +
  "plain off-white background, sticker-like clean edges, " +
  "no text, no watermark, no border, no collage, no split panels.";

const PALETTES: Record<Family, string> = {
  creature: "Palette: pastel lavender and white.",
  sushi:
    "Palette: soft pastel food colours kept light and desaturated so it sits in the same set as " +
    "the pastel creatures — cream white rice, muted salmon pink, pale coral red, soft dark seaweed green.",
  engimono:
    "Palette: soft pastel versions of traditional Japanese colours, kept light so it sits in the same " +
    "set as the pastel creatures — muted vermilion, pale gold, soft indigo, cream white.",
};

/// 背景指定はプロンプトの最後に置く。パレットより前に書くと、その色が背景まで
/// 塗られて暗いグラデーションになる（実際に13枚中7枚がそうなった）。
const BACKGROUND =
  "The background must be one flat off-white tone (#FAF7F2), the same for every image in this set. " +
  "No dark background, no coloured gradient, no vignette, no glow, no scene, no table surface.";

/// 見た目のトレイトを英語の指示にする。Charmは小さすぎると描き落とされるので、
/// はっきり見えるものだけにしてある。
const MOOD_TEXT: Record<string, string> = {
  Sleepy: "a gentle sleepy smile with closed eyes",
  Curious: "wide curious eyes",
  Cheerful: "a cheerful open-mouth grin",
  Calm: "a calm closed-eye smile",
  Surprised: "a slightly surprised look",
};
const ACCENT_TEXT: Record<string, string> = {
  Lilac: "soft lilac accents",
  Mint: "pale mint accents",
  Peach: "peach pink accents",
  Butter: "butter yellow accents",
  Sky: "sky blue accents",
  Cream: "cream beige accents",
};
const CHARM_TEXT: Record<string, string> = {
  Sparkle: "a bright four-pointed sparkle floating just above it",
  Ribbon: "a large soft ribbon bow tied on it",
  "Star Cheek": "a clear star-shaped marking on its cheek",
  "Cloud Tail": "a fluffy cloud-shaped tuft attached at the back",
  "Flower Crown": "a small crown of round flowers resting on top",
  "Tiny Hat": "a tiny rounded hat sitting on top",
  Blush: "strong round blush circles on both cheeks",
  Halo: "a glowing golden ring floating above it",
};
const POSE_TEXT: Record<string, string> = {
  Sitting: "sitting down, settled and low",
  Standing: "standing upright and facing forward",
  Hopping: "caught mid-hop, lifted off the ground",
  Curled: "curled up into a soft round shape",
  Leaning: "leaning forward, tilted to one side",
};

export type PieceTraits = {
  family: Family;
  motif: string;
  mood: string;
  accent: string;
  charm: string;
  pose: string;
};

function traitLines(t: PieceTraits): string {
  return [
    `Give it ${ACCENT_TEXT[t.accent]}.`,
    `It has ${CHARM_TEXT[t.charm]}.`,
    `Its face shows ${MOOD_TEXT[t.mood]}.`,
    `It is ${POSE_TEXT[t.pose]}.`,
  ].join("\n");
}

/// Genesis用。親がいないので単体で描かせる。
export function buildGenesisPrompt(t: PieceTraits): string {
  const subject =
    t.family === "creature"
      ? `Design a creature: ${t.motif}.`
      : `Design a cute mascot version of ${t.motif}. Give it a simple face so it reads as a character.`;
  return [
    subject,
    "It will later be fused with another subject from this set, so keep the silhouette simple and readable.",
    traitLines(t),
    STYLE_BASE,
    PALETTES[t.family],
    BACKGROUND,
  ].join("\n");
}

const FUSION =
  "You are given two reference images: parent A and parent B. " +
  "Each parent is a small creature, a piece of sushi, or a Japanese lucky charm. " +
  "Design ONE brand-new character that fuses both parents into a single coherent design. " +
  "Merge their silhouette, their distinctive parts and their colour accents so the result reads as " +
  "one character born from the two, not as two objects placed together. " +
  "Do not place the parents side by side.";

/// 子はseedからトレイトを引く。Fuse.sol traitsOf() と同じ計算。
export function buildChildPrompt(seed: bigint): { prompt: string; traits: Record<string, string> } {
  const idx = traitsFromSeed(seed);
  const t = {
    mood: MOODS[idx.mood],
    accent: ACCENTS[idx.accent],
    charm: CHARMS[idx.charm],
    pose: POSES[idx.pose],
  };
  const prompt = [
    FUSION,
    traitLines({ family: "creature", motif: "", ...t }),
    STYLE_BASE,
    "Palette: pastel, blended from the colours of the two parents.",
    BACKGROUND,
  ].join("\n");
  return { prompt, traits: t };
}

export { BASES };
