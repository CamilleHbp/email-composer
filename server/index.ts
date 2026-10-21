import { config } from './config';
import { database } from './db';
import { ScalewayStorage } from './storage';
import { createApp } from './app';

const settings = config();
const { db, sql } = database(settings.DATABASE_URL);
const app = await createApp(db, new ScalewayStorage(settings), settings);
await app.listen({ port: settings.PORT, host: '0.0.0.0' });
async function shutdown() { await app.close(); await sql.end(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
