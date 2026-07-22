import type { ProjectInput, ProjectRecord } from './types';

export async function listProjects(db: D1Database, userId: string): Promise<ProjectRecord[]> {
  const { results } = await db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<ProjectRecord>();

  return results;
}

export async function getProject(db: D1Database, userId: string, id: string): Promise<ProjectRecord | null> {
  return db.prepare('SELECT * FROM projects WHERE user_id = ? AND id = ?').bind(userId, id).first<ProjectRecord>();
}

export async function saveProject(db: D1Database, userId: string, project: ProjectInput): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  const existing = await getProject(db, userId, project.id);

  if (existing) {
    await db
      .prepare('UPDATE projects SET title = ?, description = ?, snapshot = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .bind(
        project.title ?? existing.title,
        project.description ?? existing.description,
        project.snapshot,
        now,
        userId,
        project.id,
      )
      .run();

    return {
      ...existing,
      title: project.title ?? existing.title,
      description: project.description ?? existing.description,
      snapshot: project.snapshot,
      updated_at: now,
    };
  }

  await db
    .prepare(
      'INSERT INTO projects (id, user_id, title, description, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(project.id, userId, project.title ?? null, project.description ?? null, project.snapshot, now, now)
    .run();

  return {
    id: project.id,
    user_id: userId,
    title: project.title ?? null,
    description: project.description ?? null,
    snapshot: project.snapshot,
    created_at: now,
    updated_at: now,
  };
}

export async function deleteProject(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(userId, id).run();

  return result.success;
}
