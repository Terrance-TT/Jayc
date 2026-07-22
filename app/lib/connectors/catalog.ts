export interface ConnectorEnvKey {
  /** the exact environment variable name the generated app should read */
  name: string;
  /** short description shown under the input */
  description: string;
  /** true if the value is safe to expose in browser code (publishable/anon keys) */
  publishable?: boolean;
  /** true if the connector works without this key (e.g. webhook secrets) */
  optional?: boolean;
}

export interface Connector {
  id: string;
  name: string;
  /** phosphor icon class (matches @iconify-json/ph usage across the repo) */
  icon: string;
  /** accent color for the icon chip */
  color: string;
  /** where the user creates/copies the key */
  keysUrl: string;
  /** one-liner describing what connecting this unlocks */
  tagline: string;
  envKeys: ConnectorEnvKey[];
}

/*
 * The catalog is the anti-hallucination contract: every key listed here is a
 * variable the AI is allowed to reference in generated code, because the user
 * can actually provide it through the Connectors panel.
 */
export const CONNECTORS: Connector[] = [
  {
    id: 'clerk',
    name: 'Clerk',
    icon: 'i-ph:user-circle',
    color: '#6C47FF',
    keysUrl: 'https://dashboard.clerk.com',
    tagline: 'Sign-in, sign-up and user management',
    envKeys: [
      {
        name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
        description: 'Publishable key (safe for the browser). Rename the prefix to VITE_ for Vite apps.',
        publishable: true,
      },
      {
        name: 'CLERK_SECRET_KEY',
        description: 'Secret key — server-side only, never ship to the client.',
      },
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    icon: 'i-ph:lightning',
    color: '#3ECF8E',
    keysUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    tagline: 'Postgres database, auth and storage',
    envKeys: [
      {
        name: 'NEXT_PUBLIC_SUPABASE_URL',
        description: 'Project URL (safe for the browser).',
        publishable: true,
      },
      {
        name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        description: 'Anon/public key (safe for the browser, protected by RLS).',
        publishable: true,
      },
      {
        name: 'SUPABASE_SERVICE_ROLE_KEY',
        description: 'Service role key — bypasses RLS, server-side only.',
        optional: true,
      },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    icon: 'i-ph:credit-card',
    color: '#635BFF',
    keysUrl: 'https://dashboard.stripe.com/apikeys',
    tagline: 'Payments and subscriptions',
    envKeys: [
      {
        name: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
        description: 'Publishable key (safe for the browser).',
        publishable: true,
      },
      {
        name: 'STRIPE_SECRET_KEY',
        description: 'Secret key — server-side only.',
      },
      {
        name: 'STRIPE_WEBHOOK_SECRET',
        description: 'Webhook signing secret (whsec_…).',
        optional: true,
      },
    ],
  },
  {
    id: 'neon',
    name: 'Neon',
    icon: 'i-ph:database',
    color: '#00E599',
    keysUrl: 'https://console.neon.tech',
    tagline: 'Serverless Postgres',
    envKeys: [
      {
        name: 'DATABASE_URL',
        description: 'Pooled connection string (postgres://…).',
      },
    ],
  },
  {
    id: 'upstash-redis',
    name: 'Upstash Redis',
    icon: 'i-ph:stack',
    color: '#00C98D',
    keysUrl: 'https://console.upstash.com',
    tagline: 'Serverless Redis for caching, rate limits, queues',
    envKeys: [
      {
        name: 'UPSTASH_REDIS_REST_URL',
        description: 'REST endpoint URL.',
      },
      {
        name: 'UPSTASH_REDIS_REST_TOKEN',
        description: 'REST token.',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'i-ph:robot',
    color: '#10A37F',
    keysUrl: 'https://platform.openai.com/api-keys',
    tagline: 'GPT models inside the generated app',
    envKeys: [
      {
        name: 'OPENAI_API_KEY',
        description: 'API key (sk-…) — server-side only.',
      },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    icon: 'i-ph:moon-stars',
    color: '#4F6BFE',
    keysUrl: 'https://platform.moonshot.ai/console/api-keys',
    tagline: 'Kimi models inside the generated app',
    envKeys: [
      {
        name: 'MOONSHOT_API_KEY',
        description: 'API key (sk-…) — server-side only.',
      },
    ],
  },
  {
    id: 'resend',
    name: 'Resend',
    icon: 'i-ph:paper-plane-tilt',
    color: '#000000',
    keysUrl: 'https://resend.com/api-keys',
    tagline: 'Transactional email',
    envKeys: [
      {
        name: 'RESEND_API_KEY',
        description: 'API key (re_…) — server-side only.',
      },
    ],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    icon: 'i-ph:chat-centered-text',
    color: '#F22F46',
    keysUrl: 'https://console.twilio.com',
    tagline: 'SMS and voice',
    envKeys: [
      {
        name: 'TWILIO_ACCOUNT_SID',
        description: 'Account SID (AC…).',
      },
      {
        name: 'TWILIO_AUTH_TOKEN',
        description: 'Auth token — server-side only.',
      },
      {
        name: 'TWILIO_PHONE_NUMBER',
        description: 'Sending number in E.164 format (+1…).',
        optional: true,
      },
    ],
  },
  {
    id: 'github-oauth',
    name: 'GitHub OAuth',
    icon: 'i-ph:github-logo',
    color: '#24292F',
    keysUrl: 'https://github.com/settings/developers',
    tagline: '“Sign in with GitHub” for the generated app',
    envKeys: [
      {
        name: 'GITHUB_CLIENT_ID',
        description: 'OAuth app client ID.',
      },
      {
        name: 'GITHUB_CLIENT_SECRET',
        description: 'OAuth app client secret — server-side only.',
      },
    ],
  },
];

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

/** a connector counts as connected once every non-optional key has a value */
export function isConnectorConnected(connector: Connector, vars: Record<string, string>): boolean {
  return connector.envKeys.filter((key) => !key.optional).every((key) => Boolean(vars[key.name]?.trim()));
}
