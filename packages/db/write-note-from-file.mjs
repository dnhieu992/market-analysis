/**
 * Replace a coin's "Đánh giá" note (bitget_symbol_notes) with the contents of a Markdown file.
 * Overwrites any existing note for that symbol — it prints the old note first so the replacement
 * is auditable.
 *
 * usage: node write-note-from-file.mjs <SYMBOL> <path/to/note.md> [--dry]
 */
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const [SYMBOL, FILE] = process.argv.slice(2);
if (!SYMBOL || !FILE) throw new Error('usage: node write-note-from-file.mjs <SYMBOL> <file.md> [--dry]');
const DRY = process.argv.includes('--dry');

const note = readFileSync(FILE, 'utf8').trimEnd();
if (!note) throw new Error(`${FILE} is empty — refusing to write a blank note`);

const p = new PrismaClient();
const existing = await p.bitgetSymbolNote.findUnique({ where: { symbol: SYMBOL } });

console.log(`=== ${SYMBOL} ===`);
if (existing) {
  console.log(`--- OLD note (${existing.note.length} chars, updated ${existing.updatedAt?.toISOString?.() ?? '?'}) ---`);
  console.log(existing.note);
} else {
  console.log('--- no existing note ---');
}
console.log(`\n--- NEW note (${note.length} chars) ---`);
console.log(note);

if (DRY) {
  console.log('\n[DRY RUN — nothing written]');
} else {
  await p.bitgetSymbolNote.upsert({
    where: { symbol: SYMBOL },
    create: { symbol: SYMBOL, note },
    update: { note },
  });
  console.log(`\n[written to bitget_symbol_notes] ${SYMBOL} — replaced ${existing ? `${existing.note.length} chars` : 'nothing'} with ${note.length} chars`);
}
await p.$disconnect();
