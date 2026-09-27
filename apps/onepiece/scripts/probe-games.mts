#!/usr/bin/env node
// Ad-hoc: list every tcg_games row in production so we can find whatever
// One Piece is registered under. Read-only, anon SELECT.

const { createTcgClient } = await import(
  '../../../packages/database/src/client.ts'
);

const supabase = createTcgClient();

const { data, error } = await supabase
  .from('tcg_games')
  .select('id, slug, name, active, created_at')
  .order('created_at', { ascending: true });

if (error) {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
}

console.log(`tcg_games rows: ${(data ?? []).length}`);
for (const row of data ?? []) {
  console.log(row);
}
