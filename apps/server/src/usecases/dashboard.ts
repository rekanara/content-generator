// Dashboard use case: aggregate rotation, pillars, posts, cron, queue for one group.
import type { Dashboard } from '@workspace/shared';
import type { Platform } from '../state.ts';
import { nextSlot } from '../state.ts';
import { cronStatus } from '../cron.ts';
import { queueStatus } from '../queue.ts';
import { listPosts } from '../repos/posts.ts';
import { getRotationRow, getActivePillars } from '../repos/rotation.ts';

export async function getDashboard(groupId: string): Promise<Dashboard> {
  const rot = await getRotationRow(groupId);
  const pillars = await getActivePillars(groupId);
  const next = nextSlot(
    {
      last_platform: rot.last_platform as Platform,
      last_ig_format: rot.last_ig_format,
      last_li_format: rot.last_li_format,
      last_pillar_id: rot.last_pillar_id,
    },
    pillars,
    true,
  );
  return {
    cron: cronStatus(groupId),
    queue: queueStatus(),
    rotation: {
      last_platform: rot.last_platform ?? '—',
      last_ig_format: rot.last_ig_format,
      last_li_format: rot.last_li_format,
      last_pillar_id: rot.last_pillar_id,
      updated_at: (rot.updated_at as string) ?? null,
    },
    next_slot: next,
    last_posts: await listPosts(groupId, 10),
  };
}
