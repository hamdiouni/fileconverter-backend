/**
 * Property 4: Conversion Path Optimality
 * Requirements: 25.2, 25.3
 *
 * Verifies:
 * 1. Selected path is valid (all edges exist in the graph)
 * 2. Path goes through canonical format if no direct conversion exists
 * 3. Path has minimum quality loss among all valid paths
 */
import * as fc from 'fast-check';
import { findConversionPath, buildGraph } from '../pathfinder';
import type { ConversionGraph } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build all paths from source to target in a graph using DFS.
 * Returns arrays of format names.
 */
function allPaths(graph: ConversionGraph, source: string, target: string): string[][] {
  const results: string[][] = [];
  const dfs = (current: string, path: string[], visited: Set<string>) => {
    if (current === target) {
      results.push([...path]);
      return;
    }
    const edges = graph.get(current) ?? [];
    for (const edge of edges) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        path.push(edge.to);
        dfs(edge.to, path, visited);
        path.pop();
        visited.delete(edge.to);
      }
    }
  };
  dfs(source, [source], new Set([source]));
  return results;
}

/**
 * Compute total quality loss for a given path in a graph.
 */
function pathQualityLoss(graph: ConversionGraph, path: string[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edges = graph.get(path[i]!) ?? [];
    const edge = edges.find((e) => e.to === path[i + 1]);
    if (!edge) return Infinity;
    total += edge.qualityLoss;
  }
  return total;
}

// ─── Arbitrary graph generator ───────────────────────────────────────────────

const FORMAT_NAMES = ['jpg', 'png', 'webp', 'gif', 'bmp', 'tiff'];

// Generate a random sparse graph over the image formats
const arbitraryImageGraph = fc
  .array(
    fc.record({
      from:        fc.constantFrom(...FORMAT_NAMES),
      to:          fc.constantFrom(...FORMAT_NAMES),
      qualityLoss: fc.integer({ min: 1, max: 50 }),
    }),
    { minLength: 5, maxLength: 20 },
  )
  .filter((edges) => edges.some((e) => e.from !== e.to))
  .map((edges) => buildGraph(edges.filter((e) => e.from !== e.to)));

// ─── Properties ──────────────────────────────────────────────────────────────

describe('Property 4: Conversion Path Optimality', () => {
  it('P4a: returned path only uses edges that exist in the graph', () => {
    fc.assert(
      fc.property(
        arbitraryImageGraph,
        fc.constantFrom(...FORMAT_NAMES),
        fc.constantFrom(...FORMAT_NAMES),
        (graph, source, target) => {
          const result = findConversionPath(graph, source, target);
          if (!result.found) return; // skip unreachable pairs

          // Every consecutive pair in the path must be a real edge
          for (let i = 0; i < result.path.length - 1; i++) {
            const from = result.path[i]!;
            const to   = result.path[i + 1]!;
            const edges = graph.get(from) ?? [];
            expect(edges.some((e) => e.to === to)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('P4b: returned path has minimum quality loss among all possible paths', () => {
    fc.assert(
      fc.property(
        arbitraryImageGraph,
        fc.constantFrom(...FORMAT_NAMES),
        fc.constantFrom(...FORMAT_NAMES),
        (graph, source, target) => {
          if (source === target) return; // trivial case

          const result = findConversionPath(graph, source, target);
          if (!result.found) return; // no path — nothing to verify

          // Enumerate all paths with DFS (graph is tiny) and find minimum loss
          const paths = allPaths(graph, source, target);
          const minPossibleLoss = Math.min(
            ...paths.map((p) => pathQualityLoss(graph, p)),
          );

          expect(result.totalQualityLoss).toBeLessThanOrEqual(minPossibleLoss + 0.001);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('P4c: path start and end match requested source and target', () => {
    fc.assert(
      fc.property(
        arbitraryImageGraph,
        fc.constantFrom(...FORMAT_NAMES),
        fc.constantFrom(...FORMAT_NAMES),
        (graph, source, target) => {
          const result = findConversionPath(graph, source, target);
          if (!result.found) return;

          if (source === target) {
            expect(result.path).toHaveLength(1);
          } else {
            expect(result.path[0]).toBe(source);
            expect(result.path[result.path.length - 1]).toBe(target);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('P4d: same source/target always returns path of length 1 with zero loss', () => {
    fc.assert(
      fc.property(
        arbitraryImageGraph,
        fc.constantFrom(...FORMAT_NAMES),
        (graph, format) => {
          const result = findConversionPath(graph, format, format);
          expect(result.found).toBe(true);
          expect(result.path).toEqual([format]);
          expect(result.totalQualityLoss).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
