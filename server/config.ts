import { z } from 'zod';
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  S3_ENDPOINT: z.string().url().default('https://s3.fr-par.scw.cloud'),
  S3_REGION: z.string().default('fr-par'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  ASSET_PUBLIC_BASE_URL: z.string().url().refine(s => s.startsWith('https://')),
});
export type Config = z.infer<typeof configSchema>;
export function config(): Config { return configSchema.parse(process.env); }
