/// Genesis 1000体の割り当て表を作る。
///
/// レアリティを作らないのが方針なので、**すべての軸を均等に配る**。
/// ランダムに引くと偶然の偏りが出て「レアな組み合わせ」が生まれるため、
/// 各値を必要数だけ用意してから決定論的にシャッフルする。
import { writeFile } from "node:fs/promises";
import { ACCENTS, BASES, CHARMS, FAMILY_INDEX, MOODS, POSES, type Family } from "../src/lib/traits";

const TOTAL = 1000;
/// Creature 334 / Sushi 333 / 縁起物 333
const FAMILY_TOTALS: Record<Family, number> = { creature: 334, sushi: 333, engimono: 333 };

export type GenesisPiece = {
  tokenId: number;
  family: Family;
  base: string;
  baseIndex: number;
  mood: string;
  accent: string;
  charm: string;
  pose: string;
};

/// 固定シードのxorshift。何度実行しても同じ割り当てになる。
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/// n個を len 種類に均等配分する。余りは先頭から1ずつ。
function evenly(n: number, len: number): number[] {
  const base = Math.floor(n / len);
  const extra = n % len;
  return Array.from({ length: len }, (_, i) => base + (i < extra ? 1 : 0));
}

/// 値のインデックスを、指定回数ずつ並べた配列にする
function pool(counts: number[]): number[] {
  return counts.flatMap((c, i) => Array<number>(c).fill(i));
}

function main() {
  const rand = rng(20260927);

  // ベースの割り当て: ファミリーごとに均等
  const basePool: number[] = [];
  for (const family of ["creature", "sushi", "engimono"] as const) {
    const indexes = BASES.map((b, i) => (b.family === family ? i : -1)).filter((i) => i >= 0);
    const counts = evenly(FAMILY_TOTALS[family], indexes.length);
    counts.forEach((c, k) => { for (let i = 0; i < c; i++) basePool.push(indexes[k]); });
  }
  if (basePool.length !== TOTAL) throw new Error(`base pool ${basePool.length} != ${TOTAL}`);

  // 他の軸も均等に用意してから、それぞれ独立にシャッフルする
  const bases = shuffle(basePool, rand);
  const moods = shuffle(pool(evenly(TOTAL, MOODS.length)), rand);
  const accents = shuffle(pool(evenly(TOTAL, ACCENTS.length)), rand);
  const charms = shuffle(pool(evenly(TOTAL, CHARMS.length)), rand);
  const poses = shuffle(pool(evenly(TOTAL, POSES.length)), rand);

  const pieces: GenesisPiece[] = Array.from({ length: TOTAL }, (_, i) => {
    const baseIndex = bases[i];
    return {
      tokenId: i + 1,
      family: BASES[baseIndex].family,
      base: BASES[baseIndex].name,
      baseIndex,
      mood: MOODS[moods[i]],
      accent: ACCENTS[accents[i]],
      charm: CHARMS[charms[i]],
      pose: POSES[poses[i]],
    };
  });

  return pieces;
}

/// 組み合わせの重複を消す。値を他の個体と交換するだけなので、各値の出現数は変わらない
/// （＝均等配分を崩さない）。
function dedupe(pieces: GenesisPiece[]): GenesisPiece[] {
  const key = (p: GenesisPiece) => `${p.base}|${p.mood}|${p.accent}|${p.charm}|${p.pose}`;
  const axes = ["mood", "accent", "charm", "pose"] as const;
  const rand = rng(777);

  for (let pass = 0; pass < 50; pass++) {
    const seen = new Map<string, number>();
    const dups: number[] = [];
    pieces.forEach((p, i) => {
      const k = key(p);
      if (seen.has(k)) dups.push(i);
      else seen.set(k, i);
    });
    if (dups.length === 0) return pieces;

    for (const i of dups) {
      for (let attempt = 0; attempt < 400; attempt++) {
        const axis = axes[Math.floor(rand() * axes.length)];
        const j = Math.floor(rand() * pieces.length);
        if (j === i || pieces[i][axis] === pieces[j][axis]) continue;

        const a = { ...pieces[i], [axis]: pieces[j][axis] };
        const b = { ...pieces[j], [axis]: pieces[i][axis] };
        const others = new Set(pieces.filter((_, k) => k !== i && k !== j).map(key));
        if (others.has(key(a)) || others.has(key(b)) || key(a) === key(b)) continue;

        pieces[i] = a;
        pieces[j] = b;
        break;
      }
    }
  }
  return pieces;
}

async function run() {
  const pieces = dedupe(main());
  await writeFile(new URL("genesis.json", import.meta.url), JSON.stringify(pieces, null, 1) + "\n");

  // --- 検証: 偏りが無いことを確認する ---
  const count = <K extends keyof GenesisPiece>(k: K) =>
    pieces.reduce((m, p) => m.set(String(p[k]), (m.get(String(p[k])) ?? 0) + 1), new Map<string, number>());

  const famCount = count("family");
  console.log("family :", [...famCount].map(([k, v]) => `${k}=${v}`).join(" "));
  for (const axis of ["base", "mood", "accent", "charm", "pose"] as const) {
    const c = [...count(axis).values()];
    console.log(`${axis.padEnd(7)}: ${c.length}種  最小${Math.min(...c)} 最大${Math.max(...c)}  差${Math.max(...c) - Math.min(...c)}`);
  }
  const combos = new Set(pieces.map((p) => `${p.base}|${p.mood}|${p.accent}|${p.charm}|${p.pose}`));
  console.log(`\n重複した組み合わせ: ${TOTAL - combos.size} 件`);
  console.log(`書き出し: scripts/genesis.json (${pieces.length}件)`);

  // コントラクトの setGenesisFamilies に入れる値。2bit x 1000体 = 8ワード
  const words = Array<bigint>(8).fill(0n);
  for (const p of pieces) {
    const index = p.tokenId - 1;
    words[Math.floor(index / 128)] |= BigInt(FAMILY_INDEX[p.family]) << BigInt((index % 128) * 2);
  }
  await writeFile(
    new URL("genesis-families.json", import.meta.url),
    JSON.stringify(words.map((w) => w.toString()), null, 1) + "\n",
  );
  console.log("書き出し: scripts/genesis-families.json (8ワード)");
}

run().catch((e) => { console.error(e); process.exit(1); });
