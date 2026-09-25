// Artifact serving: validate the requested file against the post's format/body,
// then stream from MinIO. Used by GET /g/:slug/posts/:id/artifacts/:file.
// File names are whitelisted per format via the repo-computed artifacts list —
// no arbitrary keys, no path traversal.
import { Readable } from 'node:stream';
import { getArtifactStream, statArtifact } from '../storage.ts';
import { getPost } from '../repos/posts.ts';

const TYPES: Record<string, string> = {
  png: 'image/png',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
};

export type ArtifactFile = { stream: Readable; contentType: string; size: number };

export async function getPostArtifact(
  groupId: string,
  slug: string,
  postId: string,
  file: string,
): Promise<ArtifactFile | null> {
  if (!/^(slide-\d{2,3}\.png|carousel\.pdf|reel\.mp4)$/.test(file)) return null; // shape guard
  const post = await getPost(groupId, postId);
  if (!post || !post.artifacts.includes(file)) return null; // format/body-scoped whitelist

  const key = `${slug}/posts/${postId}/${file}`;
  const size = await statArtifact(key).catch(() => null); // missing artifact → 404, not 500
  if (size === null) return null;
  const ext = file.split('.').pop()!;
  return { stream: Readable.from(await getArtifactStream(key)), contentType: TYPES[ext] ?? 'application/octet-stream', size };
}
