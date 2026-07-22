import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';

// The PMTiles client reads a single large file via HTTP byte-range requests
// instead of downloading it whole -- this route exists to answer those Range
// requests against the local file on disk (dev/small-scale hosting; see
// CLAUDE.md for the Cloudflare R2 path once this needs to serve strangers).
//
// Only known filenames are servable -- `file` never touches fs.* unvalidated,
// so this can't be used to read arbitrary paths on the machine.
const KNOWN_FILES: Record<string, string | undefined> = {
  'planet.pmtiles': process.env.TILES_PATH,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const filePath = KNOWN_FILES[file];
  if (!filePath) return NextResponse.json({ error: 'unknown tile file' }, { status: 404 });

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return NextResponse.json({ error: 'tile file not found on server -- check TILES_PATH' }, { status: 500 });
  }

  const range = request.headers.get('range');
  if (!range) {
    // The PMTiles client always sends Range; a bare GET (e.g. opening the
    // URL directly) gets the whole 35GB file otherwise, which is never what
    // anyone wants here.
    return NextResponse.json(
      { error: 'this endpoint only serves byte ranges; use a PMTiles client' },
      { status: 400 }
    );
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return NextResponse.json({ error: 'malformed Range header' }, { status: 416 });

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (start >= stat.size || end >= stat.size || start > end) {
    return new NextResponse(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${stat.size}` },
    });
  }

  const nodeStream = fs.createReadStream(filePath, { start, end });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 206,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
