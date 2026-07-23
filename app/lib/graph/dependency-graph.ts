import type { FileMap } from '~/lib/stores/files';
import { WORK_DIR } from '~/utils/constants';

/**
 * Builds an honest, best-effort dependency graph from the files that actually
 * exist in the project. Edges come exclusively from real import statements
 * (`import`/`export from`/`require`/dynamic `import()` in code, `@import` in
 * stylesheets, `<script src>`/`<link href>` in markup) found in the actual
 * file contents. Nothing is assumed or filled in — if two files are not
 * connected, they simply have no edge.
 */

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
  /** true when the node only exists because another file imports a path that does not exist */
  missing: boolean;
}

export interface DependencyEdge {
  /** the file that contains the import statement */
  source: string;
  /** the file being imported */
  target: string;
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

const CODE_IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, // import ... from '...'
  /\bimport\s*['"]([^'"]+)['"]/g, // import '...' (side effect)
  /\bexport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, // export ... from '...'
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, // require('...')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('...')
];

const STYLE_IMPORT_PATTERNS = [/@import\s+['"]([^'"]+)['"]/g, /@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)/g];

const MARKUP_IMPORT_PATTERNS = [
  /<script\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi,
  /<link\b[^>]*?\bhref\s*=\s*['"]([^'"]+)['"]/gi,
];

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
  const edgeKeys = new Set<string>();
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

  const addEdge = (source: string, target: string) => {
    if (source === target) {
      return;
    }

    const key = `${source} → ${target}`;

    if (edgeKeys.has(key)) {
      return;
    }

    edgeKeys.add(key);
    edges.push({ source, target });

    const sourceNode = getOrCreateNode(source, false);
    const targetNode = nodeByPath.get(target) ?? getOrCreateNode(target, true);

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
    const plainIsRelative = STYLE_EXTENSIONS.has(ext) || MARKUP_EXTENSIONS.has(ext);

    for (const specifier of extractSpecifiers(path, dirent.content)) {
      const resolution = resolveSpecifier(specifier, path, fileSet, plainIsRelative);

      switch (resolution.kind) {
        case 'internal': {
          addEdge(path, resolution.path);
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
          addEdge(path, resolution.attempted);
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

  return { path, name, dir, ext, imports: [], importedBy: [], external: [], unresolved: [], missing };
}

function extractSpecifiers(filePath: string, content: string): string[] {
  const ext = extensionOf(filePath);
  let patterns: RegExp[];
  let text = content;

  if (CODE_EXTENSIONS.has(ext)) {
    patterns = CODE_IMPORT_PATTERNS;
    text = stripComments(content);
  } else if (STYLE_EXTENSIONS.has(ext)) {
    patterns = STYLE_IMPORT_PATTERNS;
  } else if (MARKUP_EXTENSIONS.has(ext)) {
    patterns = MARKUP_IMPORT_PATTERNS;
  } else {
    return [];
  }

  const specifiers = new Set<string>();

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const specifier = match[1]?.trim();

      if (specifier && !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(specifier) && !specifier.startsWith('data:')) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers];
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
