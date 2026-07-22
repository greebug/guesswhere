import DuelClient from './DuelClient';

export default async function DuelPage({ params }: { params: Promise<{ lobbyId: string }> }) {
  const { lobbyId } = await params;
  return <DuelClient lobbyId={lobbyId} />;
}
