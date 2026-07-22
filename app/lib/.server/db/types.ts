export interface ProjectRecord {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  snapshot: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectInput {
  id: string;
  snapshot: string;
  title?: string;
  description?: string;
}
