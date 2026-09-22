import { NextResponse } from 'next/server';
import { suggest } from '../../../../server/search';

// Server-side autocomplete endpoint. Runs on the Node runtime so it
// can reuse the Supabase client factory. Never exposes credentials to
// the browser — the client component fetches this URL and gets JSON.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_QUERY_LENGTH = 64;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH);
  if (raw.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }
  try {
    const suggestions = await suggest(raw);
    return NextResponse.json(
      { suggestions },
      {
        headers: {
          // Short cache — suggestions are near-stable per prefix.
          'Cache-Control': 'public, max-age=60, s-maxage=60',
        },
      },
    );
  } catch (err) {
    // Never leak error details to the browser. Log server-side and
    // return empty suggestions so the UI degrades quietly.
    console.error('[search/suggest] error', err);
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }
}
