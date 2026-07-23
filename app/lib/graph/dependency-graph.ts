import type { FileMap } from '~/lib/stores/files';
import { WORK_DIR } from '~/utils/constants';

/**
 * Builds an honest, best-effort dependency graph from the files that actually
 * exist in the project. Edges come exclusively from real import statements
 * (`import`/`export from`/`require`/dynamic `import()` in code, `@import` in
 * stylesheets, `<script src>`/`<link href>` in markup) found in the actual
 * file contents. Node summaries, exported names and per-edge labels are also
 * derived only from the real source — nothing is assumed or filled in.
 */

export type ImportKind = 'import' | 'side-effect' | 'require' | 'dynamic' | 're-export' | 'style' | 'script' | 'link';

export interface DependencyNode {
  /** absolute path inside the container; used as the unique node id */
  path: string;
  /** file name without the directory */
  name: string;
  /** directory the file lives in */
  dir: string;
  /** lowercase extension without the dot ('' when there is none) */
  ext: string;
  /** project files this file depends on */
  imports: string[];
  /** project files that depend on this file */
  importedBy: string[];
  /** npm package names this file imports (not drawn as file nodes) */
  external: string[];
  /** import specifiers that could not be resolved to an existing file */
  unresolved: string[];
  /** names this file exports (functions, classes, constants, types, 'default') */
  provides: string[];
  /** short factual description derived from the file's own contents */
  summary: string;
  /** true when the node only exists because another file imports a path that does not exist */
  missing: boolean;
}

export interface DependencyEdge {
  /** the file that contains the import statement */
  source: string;
  /** the file being imported */
  target: string;
  /** factual descriptions of what the source takes from the target, e.g. "imports {Router, helper}" */
  labels: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  externalPackages: string[];
  unresolvedCount: number;
}

const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte']);
const STYLE_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less']);
const MARKUP_EXTENSIONS = new Set(['html', 'htm']);
const DOC_EXTENSIONS = new Set(['md', 'mdx', 'txt']);

const RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
];

const IMPORT_FROM_PATTERN = /\bimport\s+(?:type\s+)?([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_PATTERN = /\bimport\s*['"]([^'"]+)['"]/g;
const EXPORT_FROM_PATTERN = /\bexport\s+(?:type\s+)?([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/g;
const REQUIRE_WITH_BINDING_PATTERN = /\b(?:const|let|var)\s+([^=;]+?)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_PATTERN = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const STYLE_IMPORT_PATTERNS = [/@import\s+['"]([^'"]+)['"]/g, /@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)/g];

const SCRIPT_SRC_PATTERN = /<script\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi;
const LINK_HREF_PATTERN = /<link\b[^>]*?\bhref\s*=\s*['"]([^'"]+)['"]/gi;

const EXPORT_DECLARATION_PATTERN =
  /\bexport\s+(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_BRACE_PATTERN = /\bexport\s*\{([^}]*)\}/g;
const EXPORT_DEFAULT_PATTERN = /\bexport\s+default\b/;

interface ExtractedImport {
  specifier: string;
  kind: ImportKind;
  names: string[];
}

export function buildDependencyGraph(files: FileMap | undefined): DependencyGraph {
  const fileSet = new Set<string>();

  if (files) {
    for (const [path, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file') {
        fileSet.add(path);
      }
    }
  }

  const nodeByPath = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  const edgeByKey = new Map<string, DependencyEdge>();
  const externalPackages = new Set<string>();
  let unresolvedCount = 0;

  const getOrCreateNode = (path: string, missing: boolean) => {
    let node = nodeByPath.get(path);

    if (!node) {
      node = createNode(path, missing);
      nodeByPath.set(path, node);
    }

    return node;
  };

  for (const path of fileSet) {
    getOrCreateNode(path, false);
  }

  const addEdge = (source: string, target: string, label: string) => {
    if (source === target) {
      return;
    }

    const key = `${source} → ${target}`;
    const sourceNode = getOrCreateNode(source, false);
    const targetNode = nodeByPath.get(target) ?? getOrCreateNode(target, true);

    let edge = edgeByKey.get(key);

    if (!edge) {
      edge = { source, target, labels: [] };
      edgeByKey.set(key, edge);
      edges.push(edge);
    }

    if (!edge.labels.includes(label)) {
      edge.labels.push(label);
    }

    if (!sourceNode.imports.includes(target)) {
      sourceNode.imports.push(target);
    }

    if (!targetNode.importedBy.includes(source)) {
      targetNode.importedBy.push(source);
    }
  };

  for (const path of fileSet) {
    const dirent = files?.[path];

    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }

    const node = getOrCreateNode(path, false);
    const ext = extensionOf(path);

    node.provides = extractExports(dirent.content, ext);
    node.summary = summarize(path, dirent.content, ext, node.provides);

    const plainIsRelative = STYLE_EXTENSIONS.has(ext) || MARKUP_EXTENSIONS.has(ext);

    for (const imported of extractImports(path, dirent.content)) {
      const resolution = resolveSpecifier(imported.specifier, path, fileSet, plainIsRelative);

      switch (resolution.kind) {
        case 'internal': {
          addEdge(path, resolution.path, labelFor(imported.kind, imported.names));
          break;
        }
        case 'external': {
          externalPackages.add(resolution.pkg);

          if (!node.external.includes(resolution.pkg)) {
            node.external.push(resolution.pkg);
          }

          break;
        }
        case 'unresolved': {
          unresolvedCount++;
          node.unresolved.push(resolution.specifier);

          /**
           * Broken imports are drawn as dashed "missing" nodes so the graph
           * honestly shows connections that point at files which do not exist.
           */
          addEdge(path, resolution.attempted, labelFor(imported.kind, imported.names));
          break;
        }
      }
    }
  }

  const nodes = [...nodeByPath.values()].sort((a, b) => a.path.localeCompare(b.path));

  for (const node of nodes) {
    node.imports.sort();
    node.importedBy.sort();
    node.external.sort();
  }

  return {
    nodes,
    edges,
    externalPackages: [...externalPackages].sort(),
    unresolvedCount,
  };
}

function createNode(path: string, missing: boolean): DependencyNode {
  const name = path.split('/').pop() ?? path;
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash > 0 ? path.slice(0, lastSlash) : '/';
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';

  return {
    path,
    name,
    dir,
    ext,
    imports: [],
    importedBy: [],
    external: [],
    unresolved: [],
    provides: [],
    summary: missing ? 'Imported by other files, but missing from the project' : '',
    missing,
  };
}

function extractImports(filePath: string, content: string): ExtractedImport[] {
  const ext = extensionOf(filePath);
  const merged = new Map<string, ExtractedImport>();

  const collect = (specifier: string | undefined, kind: ImportKind, names: string[] = []) => {
    const cleaned = specifier?.trim();

    if (!cleaned || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(cleaned) || cleaned.startsWith('data:')) {
      return;
    }

    const existing = merged.get(cleaned);

    if (existing) {
      for (const name of names) {
        if (!existing.names.includes(name)) {
          existing.names.push(name);
        }
      }

      return;
    }

    merged.set(cleaned, { specifier: cleaned, kind, names: [...names] });
  };

  if (CODE_EXTENSIONS.has(ext)) {
    const text = stripComments(content);

    for (const match of text.matchAll(IMPORT_FROM_PATTERN)) {
      collect(match[2], 'import', parseImportedNames(match[1] ?? ''));
    }

    for (const match of text.matchAll(SIDE_EFFECT_IMPORT_PATTERN)) {
      collect(match[1], 'side-effect');
    }

    for (const match of text.matchAll(EXPORT_FROM_PATTERN)) {
      collect(match[2], 're-export', parseImportedNames(match[1] ?? ''));
    }

    for (const match of text.matchAll(REQUIRE_WITH_BINDING_PATTERN)) {
      collect(match[2], 'require', parseImportedNames(match[1] ?? ''));
    }

    for (const match of text.matchAll(REQUIRE_PATTERN)) {
      collect(match[1], 'require');
    }

    for (const match of text.matchAll(DYNAMIC_IMPORT_PATTERN)) {
      collect(match[1], 'dynamic');
    }
  } else if (STYLE_EXTENSIONS.has(ext)) {
    for (const pattern of STYLE_IMPORT_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        collect(match[1], 'style');
      }
    }
  } else if (MARKUP_EXTENSIONS.has(ext)) {
    for (const match of content.matchAll(SCRIPT_SRC_PATTERN)) {
      collect(match[1], 'script');
    }

    for (const match of content.matchAll(LINK_HREF_PATTERN)) {
      collect(match[1], 'link');
    }
  }

  return [...merged.values()];
}

/**
 * Parses the binding clause of an import/require/export-from statement into
 * human-readable names: `React, { useState as useSt, type Todo }` becomes
 * `['React', 'useState as useSt', 'Todo']`, `* as store` becomes `* as store`.
 */
function parseImportedNames(clause: string): string[] {
  const names: string[] = [];
  const trimmed = clause.trim();

  if (!trimmed) {
    return names;
  }

  const namespaceMatch = trimmed.match(/\*\s+as\s+([\w$]+)/);

  if (namespaceMatch) {
    names.push(`* as ${namespaceMatch[1]}`);
  } else if (trimmed === '*') {
    names.push('everything');
  }

  const namedMatch = trimmed.match(/\{([\s\S]*?)\}/);

  if (namedMatch) {
    for (const part of namedMatch[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '');

      if (name) {
        names.push(name);
      }
    }
  }

  const remainder = trimmed
    .replace(/\{[\s\S]*?\}/, '')
    .replace(/\*\s+as\s+[\w$]+/, '')
    .replace(/,/g, ' ')
    .trim();

  if (remainder && remainder !== '*') {
    names.unshift(remainder.replace(/^type\s+/, ''));
  }

  return names;
}

function extractExports(content: string, ext: string): string[] {
  if (!CODE_EXTENSIONS.has(ext)) {
    return [];
  }

  const text = stripComments(content);
  const exports: string[] = [];

  for (const match of text.matchAll(EXPORT_DECLARATION_PATTERN)) {
    if (match[1]) {
      exports.push(match[1]);
    }
  }

  for (const match of text.matchAll(EXPORT_BRACE_PATTERN)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '');

      if (name) {
        // "a as b" re-exports are listed under their exported name
        const asMatch = name.match(/\bas\s+([\w$]+)$/);
        exports.push(asMatch ? asMatch[1] : name);
      }
    }
  }

  if (EXPORT_DEFAULT_PATTERN.test(text)) {
    exports.push('default');
  }

  return [...new Set(exports)];
}

/**
 * A short, strictly factual description derived from the file's own name,
 * extension and contents. It never claims more than what is visible in the
 * source (e.g. "contains JSX" → React component module).
 */
function summarize(filePath: string, content: string, ext: string, provides: string[]): string {
  const name = filePath.split('/').pop() ?? '';

  if (MARKUP_EXTENSIONS.has(ext)) {
    return 'Entry HTML page';
  }

  if (STYLE_EXTENSIONS.has(ext)) {
    return 'Stylesheet';
  }

  if (ext === 'json') {
    if (name === 'package.json') {
      return 'npm package manifest (scripts & dependencies)';
    }

    if (name.startsWith('tsconfig')) {
      return 'TypeScript compiler configuration';
    }

    return 'JSON data / configuration';
  }

  if (DOC_EXTENSIONS.has(ext)) {
    return 'Documentation';
  }

  if (!CODE_EXTENSIONS.has(ext)) {
    return 'Static asset';
  }

  const usesEnvVars = /process\.env\.|import\.meta\.env\./.test(content);
  const envSuffix = usesEnvVars ? ' · reads env vars' : '';

  if (/\.(test|spec)\.[jt]sx?$/.test(name)) {
    return `Test file${envSuffix}`;
  }

  if (/^(?:vite|next|nuxt|astro|remix|tailwind|postcss|eslint|jest|vitest|rollup|webpack)\.config/.test(name)) {
    return `Build / tool configuration${envSuffix}`;
  }

  if (/(?:express\(\)|new Hono\b|fastify\(|createServer\()/.test(content)) {
    return `HTTP server${envSuffix}`;
  }

  const hasValueExports = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var|enum|default)\b/m.test(content);
  const hasTypeExports = /^\s*export\s+(?:interface|type)\b/m.test(content);

  if (hasTypeExports && !hasValueExports) {
    return 'Type definitions';
  }

  const hasJsx = /<[A-Z][\w$.]*[\s/>]/.test(content) || /return\s*\(?\s*<[a-z]/.test(content);

  if (hasJsx) {
    return `React component module${envSuffix}`;
  }

  const hooks = provides.filter((provided) => /^use[A-Z]/.test(provided));

  if (hooks.length > 0) {
    return `React hook(s): ${hooks.join(', ')}${envSuffix}`;
  }

  return provides.length > 0 ? `Module exporting ${provides.length} item(s)${envSuffix}` : `Module${envSuffix}`;
}

function labelFor(kind: ImportKind, names: string[]): string {
  const formatted = names.length > 0 ? ` {${names.join(', ')}}` : '';

  switch (kind) {
    case 'import':
      return `imports${formatted}`;
    case 'side-effect':
      return 'imports for side effects';
    case 'require':
      return `requires${formatted}`;
    case 'dynamic':
      return 'lazy-loads';
    case 're-export':
      return `re-exports${formatted}`;
    case 'style':
      return 'imports the stylesheet';
    case 'script':
      return 'loads the script';
    case 'link':
      return 'links the resource';
  }
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/gm, '$1');
}

type Resolution =
  | { kind: 'internal'; path: string }
  | { kind: 'external'; pkg: string }
  | { kind: 'unresolved'; specifier: string; attempted: string };

function resolveSpecifier(
  specifier: string,
  importerPath: string,
  fileSet: Set<string>,
  plainIsRelative: boolean,
): Resolution {
  const importerDir = dirOf(importerPath);
  const candidates: string[] = [];

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    candidates.push(normalizePath(`${importerDir}/${specifier}`));
  } else if (specifier.startsWith('~/') || specifier.startsWith('@/')) {
    const rest = specifier.slice(2);

    candidates.push(normalizePath(`${WORK_DIR}/${rest}`), normalizePath(`${WORK_DIR}/src/${rest}`));
  } else if (specifier.startsWith('/')) {
    candidates.push(normalizePath(specifier), normalizePath(`${WORK_DIR}${specifier}`));
  } else if (plainIsRelative) {
    // in stylesheets and markup a bare path is still a file reference, not a package
    candidates.push(normalizePath(`${importerDir}/${specifier}`));
  } else {
    return { kind: 'external', pkg: packageNameOf(specifier) };
  }

  for (const candidate of candidates) {
    const resolved = resolveAsFile(candidate, fileSet);

    if (resolved) {
      return { kind: 'internal', path: resolved };
    }
  }

  return { kind: 'unresolved', specifier, attempted: candidates[0] };
}

/**
 * TypeScript files are allowed to import their siblings using the *compiled*
 * extension — `import './store.js'` inside `main.ts` resolves to `store.ts`
 * under node16/nodenext/bundler module resolution (and in Vite/esbuild).
 * These mappings mirror that behavior so such imports are not falsely
 * reported as missing. Imports that are genuinely broken still fail to
 * resolve and show up as unresolved.
 */
const COMPILED_EXTENSION_EQUIVALENTS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

function resolveAsFile(base: string, fileSet: Set<string>): string | undefined {
  if (fileSet.has(base)) {
    return base;
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileSet.has(base + ext)) {
      return base + ext;
    }
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileSet.has(`${base}/index${ext}`)) {
      return `${base}/index${ext}`;
    }
  }

  for (const [compiledExt, sourceExts] of Object.entries(COMPILED_EXTENSION_EQUIVALENTS)) {
    if (!base.endsWith(compiledExt)) {
      continue;
    }

    const stem = base.slice(0, -compiledExt.length);

    for (const sourceExt of sourceExts) {
      if (fileSet.has(stem + sourceExt)) {
        return stem + sourceExt;
      }
    }
  }

  return undefined;
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');

  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dotIndex = name.lastIndexOf('.');

  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

function dirOf(path: string): string {
  const lastSlash = path.lastIndexOf('/');

  return lastSlash > 0 ? path.slice(0, lastSlash) : '/';
}

function normalizePath(path: string): string {
  const parts = path.split('/');
  const output: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      output.pop();
      continue;
    }

    output.push(part);
  }

  return `/${output.join('/')}`;
}
