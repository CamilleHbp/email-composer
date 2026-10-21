import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { Config } from './config';

export interface ObjectStore {
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  publish(privateKey: string, publicKey: string, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string): string;
}
export class ScalewayStorage implements ObjectStore {
  readonly client: S3Client;
  constructor(readonly settings: Config) {
    this.client = new S3Client({
      region: settings.S3_REGION, endpoint: settings.S3_ENDPOINT,
      credentials: { accessKeyId: settings.S3_ACCESS_KEY_ID, secretAccessKey: settings.S3_SECRET_ACCESS_KEY },
      maxAttempts: 3, requestHandler: { connectionTimeout: 5000, requestTimeout: 20000 },
    });
  }
  async put(key: string, body: Uint8Array, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.S3_BUCKET, Key: key, Body: body, ContentType: mime }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.settings.S3_BUCKET, Key: key }));
    if (!r.Body) throw new Error('storage_unavailable');
    return r.Body.transformToByteArray();
  }
  async publish(privateKey: string, publicKey: string, mime: string) {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.settings.S3_BUCKET, Key: publicKey,
      CopySource: `${this.settings.S3_BUCKET}/${privateKey.split('/').map(encodeURIComponent).join('/')}`,
      MetadataDirective: 'REPLACE', ContentType: mime, CacheControl: 'public,max-age=86400',
    }));
    await this.client.send(new HeadObjectCommand({ Bucket: this.settings.S3_BUCKET, Key: publicKey }));
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.S3_BUCKET, Key: key }));
  }
  url(key: string) { return `${this.settings.ASSET_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`; }
}
