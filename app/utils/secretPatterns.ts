/*
 * Heuristic detector for secrets / API keys.
 *
 * `.env` files are already kept out of chat diffs and history, but a user can still paste a
 * key directly into the chat input, or type one into a code file (which then travels to the
 * model inside the file-modification diff and into cloud-synced chat history). This detector
 * lets the UI warn in those cases.
 *
 * The patterns are deliberately specific - long, high-entropy prefixes - to keep false
 * positives rare. Detection is best-effort and only ever used to warn, never to block.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/, // OpenAI-style secret keys
  /sk_live_/, // Stripe live secret key
  /sk_test_/, // Stripe test secret key
  /pk_live_/, // stripe live publishable key
  /service_role/, // Supabase service_role (full-access) key
  /whsec_/, // Stripe webhook signing secret
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /AIza[0-9A-Za-z_-]{30,}/, // Google API key
  /ghp_[A-Za-z0-9]{30,}/, // GitHub personal access token
  /gho_[A-Za-z0-9]{30,}/, // github OAuth token
  /github_pat_[A-Za-z0-9_]{20,}/, // github fine-grained personal access token
  /AKIA[0-9A-Z]{16}/, // AWS access key ID
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /eyJ[A-Za-z0-9_-]{20,}\.eyJ/, // JWT (header.payload)

  // database connection strings that embed credentials (user:password@host)
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/@]+:[^@\s/]+@/,
];

/**
 * Returns true when `text` contains something that looks like a secret or API key.
 */
export function looksLikeSecret(text: string): boolean {
  if (!text) {
    return false;
  }

  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}
