import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { buildDependencyGraph, type DependencyGraph, type DependencyNode } from '~/lib/graph/dependency-graph';
import type { FileMap } from '~/lib/stores/files';
import { WORK_DIR } from '~/utils/constants';

interface FileGraphProps {
  files?: FileMap;
  onOpenFile?: (filePath: string) => void;
}

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const PADDING = 70;
const HOVER_CARD_WIDTH = 300;

const CATEGORY_COLORS: Record<string, string> = {
  TypeScript: '#7e93c4',
  JavaScript: '#c2a35a',
  Styles: '#a887b8',
  Markup: '#bd8464',
  JSON: '#7fa88f',
  Docs: '#9a9a90',
  Other: '#8a8f98',
  Missing: '#c06055',
};

const EDGE_COLOR = '#8f959e';
const EDGE_ACTIVE_COLOR = '#e0a34e';

export const FileGraph = memo(({ files, onOpenFile }: FileGraphProps) => {
  const graph = useMemo(() => buildDependencyGraph(files), [files]);
  const layoutPositions = useMemo(() => computeLayout(graph), [graph]);
  const nodeByPath = useMemo(() => new Map(graph.nodes.map((node) => [node.path, node])), [graph]);

  /**
   * Live node positions. They start from the computed layout, but the user
   * can drag nodes around freely — edges read from this same map, so lines
   * stay attached while dragging. When the project changes, dragged spots
   * are kept for files that still exist and only new files get laid out.
   */
  const [positions, setPositions] = useState(layoutPositions);

  useEffect(() => {
    setPositions((current) => {
      const next = new Map<string, LayoutPoint>();

      for (const [path, point] of layoutPositions) {
        next.set(path, current.get(path) ?? point);
      }

      return next;
    });
  }, [layoutPositions]);

  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<{ path: string; x: number; y: number } | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });

  const svgRef = useRef<SVGSVGElement>(null);
  const backgroundRef = useRef<SVGRectElement>(null);
  const panState = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const dragState = useRef<{
    pointerId: number;
    path: string;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const didDragRef = useRef(false);

  // drop the selection if the selected file no longer exists
  useEffect(() => {
    if (selectedPath && !nodeByPath.has(selectedPath)) {
      setSelectedPath(undefined);
    }
  }, [nodeByPath, selectedPath]);

  // wheel zoom — attached manually so it can be non-passive and call preventDefault
  useEffect(() => {
    const svg = svgRef.current;

    if (!svg) {
      return undefined;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;

      setView((current) => ({ ...current, k: Math.min(4, Math.max(0.2, current.k * factor)) }));
    };

    svg.addEventListener('wheel', onWheel, { passive: false });

    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const selectedNode = selectedPath ? nodeByPath.get(selectedPath) : undefined;
  const hoveredNode = hovered ? nodeByPath.get(hovered.path) : undefined;

  const neighborhood = useMemo(() => {
    if (!selectedNode) {
      return undefined;
    }

    return new Set([selectedNode.path, ...selectedNode.imports, ...selectedNode.importedBy]);
  }, [selectedNode]);

  const presentCategories = useMemo(() => {
    const categories = new Set<string>();

    for (const node of graph.nodes) {
      categories.add(categoryOf(node));
    }

    return [...categories];
  }, [graph]);

  const fileCount = graph.nodes.filter((node) => !node.missing).length;

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-bolt-elements-textSecondary">
        No files yet. Generate an app, then come back here to see how its files are actually connected.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(event) => {
          panState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: view.x,
            originY: view.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pan = panState.current;

          if (!pan || pan.pointerId !== event.pointerId) {
            return;
          }

          const rect = svgRef.current?.getBoundingClientRect();
          const scale = rect ? Math.min(rect.width / CANVAS_WIDTH, rect.height / CANVAS_HEIGHT) || 1 : 1;

          setView((current) => ({
            ...current,
            x: pan.originX + (event.clientX - pan.startX) / scale,
            y: pan.originY + (event.clientY - pan.startY) / scale,
          }));
        }}
        onPointerUp={(event) => {
          const pan = panState.current;

          if (pan && pan.pointerId === event.pointerId) {
            const moved = Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY);

            if (moved < 4 && event.target === backgroundRef.current) {
              setSelectedPath(undefined);
            }

            panState.current = null;
          }
        }}
        onPointerCancel={() => {
          panState.current = null;
        }}
      >
        <defs>
          <marker id="fg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill={EDGE_COLOR} />
          </marker>
          <marker
            id="fg-arrow-active"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill={EDGE_ACTIVE_COLOR} />
          </marker>
        </defs>
        <rect ref={backgroundRef} x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="transparent" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);

            if (!source || !target) {
              return null;
            }

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const length = Math.hypot(dx, dy) || 1;
            const trim = nodeRadius(nodeByPath.get(edge.target)) + 5;
            const isActive = selectedPath !== undefined && (edge.source === selectedPath || edge.target === selectedPath);
            const isDimmed = selectedPath !== undefined && !isActive;

            return (
              <line
                key={`${edge.source} → ${edge.target}`}
                x1={source.x}
                y1={source.y}
                x2={target.x - (dx / length) * trim}
                y2={target.y - (dy / length) * trim}
                stroke={isActive ? EDGE_ACTIVE_COLOR : EDGE_COLOR}
                strokeWidth={isActive ? 2 : 1.2}
                strokeOpacity={isDimmed ? 0.12 : isActive ? 0.95 : 0.45}
                markerEnd={isActive ? 'url(#fg-arrow-active)' : 'url(#fg-arrow)'}
              />
            );
          })}
          {graph.nodes.map((node) => {
            const point = positions.get(node.path);

            if (!point) {
              return null;
            }

            const radius = nodeRadius(node);
            const isSelected = node.path === selectedPath;
            const isDimmed = neighborhood !== undefined && !neighborhood.has(node.path);
            const color = CATEGORY_COLORS[categoryOf(node)];
            const label = node.name.length > 22 ? `${node.name.slice(0, 20)}…` : node.name;

            return (
              <g
                key={node.path}
                transform={`translate(${point.x} ${point.y})`}
                opacity={isDimmed ? 0.3 : 1}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setHovered(null);

                  dragState.current = {
                    pointerId: event.pointerId,
                    path: node.path,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    originX: point.x,
                    originY: point.y,
                    moved: false,
                  };

                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = dragState.current;

                  if (!drag || drag.pointerId !== event.pointerId || drag.path !== node.path) {
                    return;
                  }

                  const clientDx = event.clientX - drag.startClientX;
                  const clientDy = event.clientY - drag.startClientY;

                  if (!drag.moved && Math.hypot(clientDx, clientDy) < 3) {
                    return;
                  }

                  drag.moved = true;

                  const rect = svgRef.current?.getBoundingClientRect();
                  const meetScale = rect ? Math.min(rect.width / CANVAS_WIDTH, rect.height / CANVAS_HEIGHT) || 1 : 1;
                  const scale = meetScale * view.k;

                  setPositions((current) => {
                    const next = new Map(current);
                    next.set(drag.path, { x: drag.originX + clientDx / scale, y: drag.originY + clientDy / scale });

                    return next;
                  });
                }}
                onPointerUp={(event) => {
                  const drag = dragState.current;

                  if (drag && drag.pointerId === event.pointerId) {
                    didDragRef.current = drag.moved;
                    dragState.current = null;
                  }
                }}
                onPointerCancel={() => {
                  dragState.current = null;
                }}
                onClick={(event) => {
                  event.stopPropagation();

                  if (didDragRef.current) {
                    didDragRef.current = false;
                    return;
                  }

                  setSelectedPath(isSelected ? undefined : node.path);
                }}
                onMouseEnter={(event) => {
                  setHovered({ path: node.path, x: event.clientX, y: event.clientY });
                }}
                onMouseMove={(event) => {
                  setHovered({ path: node.path, x: event.clientX, y: event.clientY });
                }}
                onMouseLeave={() => {
                  setHovered((current) => (current?.path === node.path ? null : current));
                }}
              >
                {isSelected && (
                  <circle r={radius + 5} fill="none" stroke={EDGE_ACTIVE_COLOR} strokeWidth={1.5} strokeOpacity={0.8} />
                )}
                <circle
                  r={radius}
                  fill={node.missing ? 'transparent' : color}
                  fillOpacity={node.missing ? 0 : 0.85}
                  stroke={node.missing ? CATEGORY_COLORS.Missing : isSelected ? '#ffffff' : color}
                  strokeWidth={node.missing ? 1.5 : isSelected ? 2 : 1}
                  strokeDasharray={node.missing ? '4 3' : undefined}
                />
                <text
                  y={radius + 13}
                  textAnchor="middle"
                  fontSize={10}
                  fontStyle={node.missing ? 'italic' : undefined}
                  fill="currentColor"
                  className="text-bolt-elements-textSecondary"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {label}
                </text>
                <title>{relativeToWorkDir(node.path)}</title>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute left-3 top-3 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-1.5 text-xs text-bolt-elements-textSecondary">
        <span className="font-medium text-bolt-elements-textPrimary">{fileCount}</span> files ·{' '}
        <span className="font-medium text-bolt-elements-textPrimary">{graph.edges.length}</span> connections ·{' '}
        <span className="font-medium text-bolt-elements-textPrimary">{graph.externalPackages.length}</span> packages
        {graph.unresolvedCount > 0 && (
          <>
            {' '}
            · <span className="font-medium text-bolt-elements-icon-error">{graph.unresolvedCount}</span> unresolved
          </>
        )}
      </div>

      <div className="absolute bottom-3 left-3 flex max-w-[60%] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-1.5 text-xs text-bolt-elements-textSecondary">
        {presentCategories.map((category) => (
          <span key={category} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: category === 'Missing' ? 'transparent' : CATEGORY_COLORS[category],
                border: category === 'Missing' ? `1.5px dashed ${CATEGORY_COLORS.Missing}` : undefined,
              }}
            />
            {category === 'Missing' ? 'Missing file' : category}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="14" y2="3" stroke={EDGE_COLOR} strokeWidth="1.2" />
            <path d="M 14 0 L 18 3 L 14 6 z" fill={EDGE_COLOR} />
          </svg>
          imports
        </span>
      </div>

      <div className="absolute bottom-3 right-3 flex gap-1">
        <button
          aria-label="Re-layout graph"
          title="Re-layout graph"
          className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-1.5 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          onClick={() => setPositions(computeLayout(graph))}
        >
          <div className="i-ph:arrows-clockwise" />
        </button>
        <button
          aria-label="Zoom in"
          className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-1.5 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          onClick={() => setView((current) => ({ ...current, k: Math.min(4, current.k * 1.25) }))}
        >
          <div className="i-ph:plus" />
        </button>
        <button
          aria-label="Zoom out"
          className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-1.5 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          onClick={() => setView((current) => ({ ...current, k: Math.max(0.2, current.k / 1.25) }))}
        >
          <div className="i-ph:minus" />
        </button>
        <button
          aria-label="Reset view"
          className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-1.5 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          onClick={() => setView({ k: 1, x: 0, y: 0 })}
        >
          <div className="i-ph:frame-corners" />
        </button>
      </div>

      {hoveredNode && hovered && (
        <div
          className="pointer-events-none fixed z-50 max-h-80 overflow-y-auto rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3 text-xs shadow-xl"
          style={{
            left: Math.min(hovered.x + 16, (typeof window === 'undefined' ? 1200 : window.innerWidth) - HOVER_CARD_WIDTH - 12),
            top: Math.min(hovered.y + 16, (typeof window === 'undefined' ? 800 : window.innerHeight) - 220),
            width: HOVER_CARD_WIDTH,
          }}
        >
          <div className="truncate font-medium text-bolt-elements-textPrimary">{hoveredNode.name}</div>
          <div className="truncate text-bolt-elements-textTertiary">{relativeToWorkDir(hoveredNode.path)}</div>
          {hoveredNode.summary && <div className="mt-1.5 text-bolt-elements-textSecondary">{hoveredNode.summary}</div>}

          {hoveredNode.provides.length > 0 && (
            <div className="mt-1.5 text-bolt-elements-textSecondary">
              <span className="text-bolt-elements-textTertiary">Exports:</span> {formatNameList(hoveredNode.provides)}
            </div>
          )}

          <HoverConnections node={hoveredNode} graph={graph} nodeByPath={nodeByPath} />
        </div>
      )}

      {selectedNode && (
        <div className="absolute right-3 top-3 max-h-[calc(100%-5rem)] w-72 max-w-[80%] overflow-y-auto rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3 text-sm shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-bolt-elements-textPrimary">{selectedNode.name}</div>
              <div className="truncate text-xs text-bolt-elements-textTertiary">{relativeToWorkDir(selectedNode.path)}</div>
            </div>
            <button
              aria-label="Close details"
              className="shrink-0 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
              onClick={() => setSelectedPath(undefined)}
            >
              <div className="i-ph:x text-lg" />
            </button>
          </div>

          {selectedNode.summary && <p className="mt-2 text-xs text-bolt-elements-textSecondary">{selectedNode.summary}</p>}

          {selectedNode.missing && (
            <p className="mt-2 text-xs" style={{ color: CATEGORY_COLORS.Missing }}>
              This file is imported by other files but does not exist in the project.
            </p>
          )}

          <DetailSection title={`Imports (${selectedNode.imports.length})`} paths={selectedNode.imports} onSelect={setSelectedPath} />
          <DetailSection
            title={`Imported by (${selectedNode.importedBy.length})`}
            paths={selectedNode.importedBy}
            onSelect={setSelectedPath}
          />

          {selectedNode.external.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium uppercase tracking-wide text-bolt-elements-textTertiary">
                Packages ({selectedNode.external.length})
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {selectedNode.external.map((pkg) => (
                  <div key={pkg} className="truncate text-bolt-elements-textSecondary" title={pkg}>
                    {pkg}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedNode.unresolved.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: CATEGORY_COLORS.Missing }}>
                Unresolved imports ({selectedNode.unresolved.length})
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {selectedNode.unresolved.map((specifier) => (
                  <code key={specifier} className="truncate text-xs text-bolt-elements-textSecondary" title={specifier}>
                    {specifier}
                  </code>
                ))}
              </div>
            </div>
          )}

          {!selectedNode.missing && onOpenFile && (
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-bolt-elements-button-primary-background px-3 py-1.5 text-sm text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover"
              onClick={() => onOpenFile(selectedNode.path)}
            >
              <div className="i-ph:code" />
              Open in editor
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const MAX_HOVER_CONNECTIONS = 5;

function HoverConnections({
  node,
  graph,
  nodeByPath,
}: {
  node: DependencyNode;
  graph: DependencyGraph;
  nodeByPath: Map<string, DependencyNode>;
}) {
  const outgoing = graph.edges.filter((edge) => edge.source === node.path);
  const incoming = graph.edges.filter((edge) => edge.target === node.path);

  if (outgoing.length === 0 && incoming.length === 0) {
    if (node.missing) {
      return null;
    }

    return (
      <div className="mt-1.5 text-bolt-elements-textTertiary">
        No connections — it imports nothing and nothing imports it.
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-bolt-elements-borderColor pt-1.5">
      {outgoing.slice(0, MAX_HOVER_CONNECTIONS).map((edge) => (
        <div key={`out-${edge.target}`} className="truncate text-bolt-elements-textSecondary">
          <span className="text-bolt-elements-textTertiary">→</span> {nodeByPath.get(edge.target)?.name ?? edge.target}{' '}
          <span className="text-bolt-elements-textTertiary">— {edge.labels.join(', ')}</span>
        </div>
      ))}
      {outgoing.length > MAX_HOVER_CONNECTIONS && (
        <div className="text-bolt-elements-textTertiary">+{outgoing.length - MAX_HOVER_CONNECTIONS} more outgoing</div>
      )}
      {incoming.slice(0, MAX_HOVER_CONNECTIONS).map((edge) => (
        <div key={`in-${edge.source}`} className="truncate text-bolt-elements-textSecondary">
          <span className="text-bolt-elements-textTertiary">←</span> {nodeByPath.get(edge.source)?.name ?? edge.source}{' '}
          <span className="text-bolt-elements-textTertiary">— {edge.labels.join(', ')}</span>
        </div>
      ))}
      {incoming.length > MAX_HOVER_CONNECTIONS && (
        <div className="text-bolt-elements-textTertiary">+{incoming.length - MAX_HOVER_CONNECTIONS} more incoming</div>
      )}
    </div>
  );
}

function formatNameList(names: string[]): string {
  const shown = names.slice(0, 8).join(', ');

  return names.length > 8 ? `${shown}, +${names.length - 8} more` : shown;
}

function DetailSection({
  title,
  paths,
  onSelect,
}: {
  title: string;
  paths: string[];
  onSelect: (path: string) => void;
}) {
  if (paths.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <div className="text-xs font-medium uppercase tracking-wide text-bolt-elements-textTertiary">{title}</div>
      <div className="mt-1 flex flex-col gap-0.5">
        {paths.map((path) => (
          <button
            key={path}
            className="truncate text-left text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
            title={relativeToWorkDir(path)}
            onClick={() => onSelect(path)}
          >
            {path.split('/').pop()}
          </button>
        ))}
      </div>
    </div>
  );
}

function categoryOf(node: DependencyNode): string {
  if (node.missing) {
    return 'Missing';
  }

  if (['ts', 'tsx', 'mts', 'cts'].includes(node.ext)) {
    return 'TypeScript';
  }

  if (['js', 'jsx', 'mjs', 'cjs'].includes(node.ext)) {
    return 'JavaScript';
  }

  if (['css', 'scss', 'sass', 'less'].includes(node.ext)) {
    return 'Styles';
  }

  if (['html', 'htm', 'vue', 'svelte'].includes(node.ext)) {
    return 'Markup';
  }

  if (node.ext === 'json') {
    return 'JSON';
  }

  if (['md', 'mdx', 'txt'].includes(node.ext)) {
    return 'Docs';
  }

  return 'Other';
}

function nodeRadius(node: DependencyNode | undefined): number {
  if (!node) {
    return 8;
  }

  return 7 + Math.min(8, node.imports.length + node.importedBy.length);
}

function relativeToWorkDir(path: string): string {
  return path.startsWith(`${WORK_DIR}/`) ? path.slice(WORK_DIR.length + 1) : path;
}

interface LayoutPoint {
  x: number;
  y: number;
}

/**
 * Deterministic force-directed layout: every node repels every other node,
 * connected nodes are pulled toward a comfortable distance, and a gentle
 * gravity keeps the graph centered. The layout derives only from the real
 * edge list — clusters and isolated files appear exactly as connected.
 */
function computeLayout(graph: DependencyGraph): Map<string, LayoutPoint> {
  const nodes = graph.nodes;
  const count = nodes.length;
  const result = new Map<string, LayoutPoint>();

  if (count === 0) {
    return result;
  }

  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;

  // golden-angle spiral start keeps the simulation deterministic
  const points = nodes.map((_node, index) => {
    const angle = index * 2.399963229728653;
    const radius = 18 * Math.sqrt(index + 0.5);

    return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
  });

  const indexByPath = new Map(nodes.map((node, index) => [node.path, index]));
  const edgePairs: Array<[number, number]> = [];

  for (const edge of graph.edges) {
    const a = indexByPath.get(edge.source);
    const b = indexByPath.get(edge.target);

    if (a !== undefined && b !== undefined) {
      edgePairs.push([a, b]);
    }
  }

  const iterations = count > 250 ? 150 : 280;
  const REPULSION = 9000;
  const SPRING = 0.03;
  const REST_LENGTH = 95;
  const GRAVITY = 0.02;
  const MAX_STEP = 12;

  const forcesX = new Float64Array(count);
  const forcesY = new Float64Array(count);

  for (let iteration = 0; iteration < iterations; iteration++) {
    forcesX.fill(0);
    forcesY.fill(0);

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = points[i].x - points[j].x;
        let dy = points[i].y - points[j].y;
        let distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < 0.01) {
          // deterministic nudge so perfectly overlapping nodes separate
          dx = (((i * 7 + j * 13) % 10) - 5) * 0.2;
          dy = (((i * 3 + j * 11) % 10) - 5) * 0.2;
          distanceSquared = dx * dx + dy * dy;
        }

        const distance = Math.sqrt(distanceSquared);
        const force = REPULSION / distanceSquared;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        forcesX[i] += fx;
        forcesY[i] += fy;
        forcesX[j] -= fx;
        forcesY[j] -= fy;
      }
    }

    for (const [a, b] of edgePairs) {
      const dx = points[b].x - points[a].x;
      const dy = points[b].y - points[a].y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const force = SPRING * (distance - REST_LENGTH);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      forcesX[a] += fx;
      forcesY[a] += fy;
      forcesX[b] -= fx;
      forcesY[b] -= fy;
    }

    for (let i = 0; i < count; i++) {
      forcesX[i] += (centerX - points[i].x) * GRAVITY;
      forcesY[i] += (centerY - points[i].y) * GRAVITY;
    }

    for (let i = 0; i < count; i++) {
      const step = Math.hypot(forcesX[i], forcesY[i]);
      const scale = step > MAX_STEP ? MAX_STEP / step : 1;

      points[i].x += forcesX[i] * scale;
      points[i].y += forcesY[i] * scale;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const fitScale = Math.min((CANVAS_WIDTH - PADDING * 2) / spanX, (CANVAS_HEIGHT - PADDING * 2) / spanY, 2);
  const offsetX = PADDING + (CANVAS_WIDTH - PADDING * 2 - spanX * fitScale) / 2;
  const offsetY = PADDING + (CANVAS_HEIGHT - PADDING * 2 - spanY * fitScale) / 2;

  nodes.forEach((node, index) => {
    result.set(node.path, {
      x: offsetX + (points[index].x - minX) * fitScale,
      y: offsetY + (points[index].y - minY) * fitScale,
    });
  });

  return result;
}
