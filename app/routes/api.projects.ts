import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import {
  deleteProject,
  getDb,
  getProject,
  listProjects,
  saveProject,
  type ProjectInput,
} from '~/lib/.server/db';

const unauthorized = () => json({ error: 'Unauthorized' }, { status: 401 });
const dbUnavailable = () => json({ error: 'Database is not configured' }, { status: 503 });

export async function loader(args: LoaderFunctionArgs) {
  const { userId } = await getAuth(args);

  if (!userId) {
    return unauthorized();
  }

  const db = getDb(args.context.cloudflare.env);

  if (!db) {
    return dbUnavailable();
  }

  const id = new URL(args.request.url).searchParams.get('id');

  if (id) {
    const project = await getProject(db, userId, id);

    if (!project) {
      return json({ error: 'Project not found' }, { status: 404 });
    }

    return json({ project });
  }

  const projects = await listProjects(db, userId);

  return json({ projects });
}

export async function action(args: ActionFunctionArgs) {
  const { userId } = await getAuth(args);

  if (!userId) {
    return unauthorized();
  }

  const db = getDb(args.context.cloudflare.env);

  if (!db) {
    return dbUnavailable();
  }

  const { request } = args;

  if (request.method === 'POST') {
    const body = await request.json<Partial<ProjectInput>>();

    if (!body.id || typeof body.snapshot !== 'string') {
      return json({ error: 'Missing required fields: id, snapshot' }, { status: 400 });
    }

    const project = await saveProject(db, userId, {
      id: body.id,
      snapshot: body.snapshot,
      title: body.title,
      description: body.description,
    });

    return json({ project });
  }

  if (request.method === 'DELETE') {
    let id = new URL(request.url).searchParams.get('id');

    if (!id) {
      const body = (await request.json<{ id?: string }>().catch(() => ({}))) as { id?: string };
      id = body.id ?? null;
    }

    if (!id) {
      return json({ error: 'Missing required field: id' }, { status: 400 });
    }

    await deleteProject(db, userId, id);

    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}
