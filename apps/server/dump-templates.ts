import { sql } from './src/db/pool.ts';
async function main() {
  const rows = await sql`select name, format, is_active, length(html) as len, html_first is not null as has_first, html_last is not null as has_last, html from templates order by format`;
  for (const r of rows) {
    console.log(`\n===== ${r.name} (${r.format}, ${r.len} chars, first=${r.has_first}, last=${r.has_last}) =====`);
    console.log(r.html.slice(0, 3500));
  }
  process.exit(0);
}
main();
