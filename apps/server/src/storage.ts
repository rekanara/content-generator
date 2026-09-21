// MinIO: upload artifacts to <slug>/posts/<id>/, fetch stream for Telegram sending.
// Slug prefix = isolation between groups (multi-account spec).
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

// Upload local file → <slug>/posts/<id>/<filename>. Returns the object key.
export async function uploadPostArtifact(slug: string, postId: string, localPath: string, filename: string): Promise<string> {
  await ensureBucket();
  const key = `${slug}/posts/${postId}/${filename}`;
  const size = statSync(localPath).size;
  await client.putObject(config.minio.bucket, key, createReadStream(localPath), size);
  return key;
}

// Stream object for sending (telegram needs stream/size).
export async function getArtifactStream(key: string): Promise<NodeJS.ReadableStream> {
  await ensureBucket();
  return client.getObject(config.minio.bucket, key);
}

// Object size or null when missing — artifact-existence check for HTTP serving.
export async function statArtifact(key: string): Promise<number> {
  await ensureBucket();
  const info = await client.statObject(config.minio.bucket, key);
  return info.size;
}

export async function artifactExists(key: string): Promise<boolean> {
  return statArtifact(key).then(() => true, () => false);
}

// Full read (cover image reuse on rerender — small files, buffer is fine).
export async function getArtifactBuffer(key: string): Promise<Buffer> {
  const stream = await getArtifactStream(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
