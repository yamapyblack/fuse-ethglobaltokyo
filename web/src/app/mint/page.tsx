import { MintView } from "@/components/MintView";

export default async function MintPage({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const { tx } = await searchParams;
  return <MintView mintTx={tx ?? null} />;
}
