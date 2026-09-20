import { sql } from '../src/db.ts';
await sql.unsafe('drop schema public cascade');
await sql.unsafe('create schema public');
console.log('schema reset');
process.exit(0);
