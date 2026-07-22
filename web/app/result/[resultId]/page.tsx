import ResultClient from './ResultClient';

export default async function ResultPage({
  params,
}: {
  params: Promise<{ resultId: string }>;
}) {
  const { resultId } = await params;
  return <ResultClient resultId={resultId} />;
}
