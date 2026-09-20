// postgres.js pool — single connection point for the whole server.
import postgres from 'postgres';
import { config } from '../config.ts';

export const sql = postgres({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});
