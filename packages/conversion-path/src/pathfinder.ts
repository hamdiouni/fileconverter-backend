/**
 * Conversion path finder.
 *
 * Uses a modified Dijkstra's algorithm to find the path with minimum quality
 * loss between two formats.  Falls back to routing through the canonical
 * intermediate format when no direct conversion exists.
 *
 * Requirements: 25.1, 25.2, 25.3
 */
import type { ConversionGraph, PathResult } from './types';
import { getCanonicalFormat } from './canonical';

// ─── Dijkstra ────────────────────────────────────────────────────────────────

interface NodeState {
  format: string;
  qualityLoss: number;
  prev: string | null;
}

/**
 * Find the minimum-quality-loss path between `source` and `target` in the
 * given conversion graph using Dijkstra's algorithm.
 *
 * @param graph   Conversion graph (adjacency list)
 * @param source  Source format
 * @param target  Target format
 * @returns PathResult with the optimal path and total quality loss
 */
export function findConversionPath(
  graph: ConversionGraph,
  source: string,
  target: string,
): PathResult {
  const src = source.toLowerCase();
  const tgt = target.toLowerCase();

  if (src === tgt) {
    return { found: true, path: [src], totalQualityLoss: 0, viaCanonical: false };
  }

  // First try direct path via Dijkstra
  const direct = dijkstra(graph, src, tgt);
  if (direct.found) {
    return { ...direct, viaCanonical: false };
  }

  // Try via canonical intermediate
  const canonical = getCanonicalFormat(src);
  if (canonical && canonical !== src && canonical !== tgt) {
    const toCanon  = dijkstra(graph, src, canonical);
    const fromCanon = dijkstra(graph, canonical, tgt);

    if (toCanon.found && fromCanon.found) {
      // Merge paths (canonical appears in both — deduplicate)
      const merged = [
        ...toCanon.path,
        ...fromCanon.path.slice(1),
      ];
      return {
        found: true,
        path: merged,
        totalQualityLoss: toCanon.totalQualityLoss + fromCanon.totalQualityLoss,
        viaCanonical: true,
      };
    }
  }

  return { found: false, path: [], totalQualityLoss: Infinity, viaCanonical: false };
}

function dijkstra(graph: ConversionGraph, source: string, target: string): PathResult {
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  // Seed all known nodes
  for (const [from, edges] of graph.entries()) {
    dist.set(from, Infinity);
    for (const e of edges) {
      if (!dist.has(e.to)) dist.set(e.to, Infinity);
    }
  }
  dist.set(source, 0);
  prev.set(source, null);

  while (true) {
    // Pick unvisited node with smallest dist
    let u: string | null = null;
    let uDist = Infinity;
    for (const [node, d] of dist.entries()) {
      if (!visited.has(node) && d < uDist) {
        u = node;
        uDist = d;
      }
    }

    if (u === null || uDist === Infinity) break; // all remaining unreachable
    if (u === target) break; // found target

    visited.add(u);

    const edges = graph.get(u) ?? [];
    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      const alt = uDist + edge.qualityLoss;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, u);
      }
    }
  }

  const targetDist = dist.get(target);
  if (targetDist === undefined || targetDist === Infinity) {
    return { found: false, path: [], totalQualityLoss: Infinity, viaCanonical: false };
  }

  // Reconstruct path
  const path: string[] = [];
  let current: string | null = target;
  while (current !== null) {
    path.unshift(current);
    current = prev.get(current) ?? null;
  }

  return { found: true, path, totalQualityLoss: targetDist, viaCanonical: false };
}

// ─── Graph builder helper ────────────────────────────────────────────────────

/**
 * Build a ConversionGraph from a flat edge list.
 */
export function buildGraph(edges: Array<{ from: string; to: string; qualityLoss: number }>): ConversionGraph {
  const graph: ConversionGraph = new Map();
  for (const edge of edges) {
    const from = edge.from.toLowerCase();
    const to   = edge.to.toLowerCase();
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from)!.push({ from, to, qualityLoss: edge.qualityLoss });
  }
  return graph;
}
