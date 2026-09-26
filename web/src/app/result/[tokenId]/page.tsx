import { ResultView } from "@/components/ResultView";

export default async function ResultPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  return <ResultView tokenId={tokenId} />;
}
