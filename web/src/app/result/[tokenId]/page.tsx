import { ResultView } from "@/components/ResultView";

export default async function ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ tx?: string }>;
}) {
  const { tokenId } = await params;
  const { tx } = await searchParams;
  return <ResultView tokenId={tokenId} fuseTx={tx ?? null} />;
}
