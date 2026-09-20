// MinIO: upload artefak posts/<id>/, ambil stream untuk kirim Telegram.
import * as Minio from 'minio';
import { createReadStream, statSync } from 'node:fs';
import { config } from './config.ts';

const client = new Minio.Client({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const exists = await client.bucketExists(config.minio.bucket);
  if (!exists) await client.makeBucket(config.minio.bucket);
  bucketReady = true;
}

// Upload file lokal → posts/<id>/<filename>. Return object key.
export async function uploadPostArtifact(postId: number, localPath: string, filename: string): Promise<string> {
  await ensureBucket();
  const key = `posts/${postId}/${filename}`;
  const size = statSync(localPath).size;
  await client.putObject(config.minio.bucket, key, createReadStream(localPath), size);
  return key;
}

// Stream object utk dikirim (telegram butuh stream/size).
export async function getArtifactStream(key: string): Promise<NodeJS.ReadableStream> {
  await ensureBucket();
  return client.getObject(config.minio.bucket, key);
}
