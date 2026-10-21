import { testDatabase, createUser, testConfig, MemoryStorage } from './helpers';
import { createApp } from '../server/app';
import { templates } from '../server/schema';
import { starter } from '../shared/starters';
const { db, client } = await testDatabase();
const id = await createUser(db, 'test@example.test', 'admin');
await db.insert(templates).values({
  ownerId: id, name: 'The October letter', kind: 'draft', document: starter('newsletter', 'en'),
});
const app = await createApp(db, new MemoryStorage(), testConfig);
await app.listen({ host: '127.0.0.1', port: 3000 });
async function stop() { await app.close(); await client.close(); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
