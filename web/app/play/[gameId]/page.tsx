import PlayClient from './PlayClient';

// Server Component wrapper: params is a Promise in this Next.js version.
// Keeping the await here (rather than inside a 'use client' page) avoids any
// ambiguity about how params crosses the server/client boundary.
export default async function PlayPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <PlayClient gameId={gameId} />;
}
