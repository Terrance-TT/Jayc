import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('CloudSync');

export interface CloudProjectSnapshot {
  messages: Message[];
  description?: string;
  timestamp: string;
}

export interface CloudProject {
  id: string;
  title?: string;
  description?: string;
  snapshot: CloudProjectSnapshot;
}

/**
 * Fire-and-forget sync of a project to the server-side D1 database.
 *
 * The chat stays usable when this fails (user not signed in, D1 not
 * configured, offline, ...) — IndexedDB remains the local cache, the cloud
 * copy is best-effort.
 */
export async function syncProjectToCloud(project: CloudProject): Promise<void> {
  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: project.id,
        title: project.title,
        description: project.description,
        snapshot: JSON.stringify(project.snapshot),
      }),
    });

    // 401 just means the user is not signed in — nothing to warn about
    if (!response.ok && response.status !== 401) {
      logger.warn(`Cloud sync failed with status ${response.status}`);
    }
  } catch {
    // silently skip — cloud sync is best-effort, local persistence already succeeded
  }
}
