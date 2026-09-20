/**
 * Unit tests for conversion path finding (Task 24.3)
 * Requirements: 25.1, 25.2, 25.3
 */
import { findConversionPath, buildGraph } from '../pathfinder';
import type { ConversionGraph } from '../types';

// ─── Test graph ───────────────────────────────────────────────────────────────
// Image family: jpg ↔ png ↔ webp ↔ gif
// png is the canonical for images

const IMAGE_EDGES = [
  { from: 'jpg',  to: 'png',  qualityLoss: 5 },
  { from: 'png',  to: 'jpg',  qualityLoss: 10 },
  { from: 'png',  to: 'webp', qualityLoss: 3 },
  { from: 'webp', to: 'png',  qualityLoss: 2 },
  { from: 'png',  to: 'gif',  qualityLoss: 20 },
  { from: 'gif',  to: 'png',  qualityLoss: 15 },
];

const GRAPH = buildGraph(IMAGE_EDGES);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('findConversionPath - direct conversions', () => {
  it('finds direct jpg → png path with correct quality loss', () => {
    const result = findConversionPath(GRAPH, 'jpg', 'png');
    expect(result.found).toBe(true);
    expect(result.path).toEqual(['jpg', 'png']);
    expect(result.totalQualityLoss).toBe(5);
    expect(result.viaCanonical).toBe(false);
  });

  it('finds direct png → webp path', () => {
    const result = findConversionPath(GRAPH, 'png', 'webp');
    expect(result.found).toBe(true);
    expect(result.path).toEqual(['png', 'webp']);
    expect(result.totalQualityLoss).toBe(3);
  });

  it('returns same format trivially (zero loss)', () => {
    const result = findConversionPath(GRAPH, 'png', 'png');
    expect(result.found).toBe(true);
    expect(result.path).toEqual(['png']);
    expect(result.totalQualityLoss).toBe(0);
  });

  it('selects minimum loss path when multiple options exist', () => {
    // jpg → gif: direct path doesn't exist, must go jpg→png→gif (5+20=25)
    const result = findConversionPath(GRAPH, 'jpg', 'gif');
    expect(result.found).toBe(true);
    expect(result.totalQualityLoss).toBe(25); // jpg→png (5) + png→gif (20)
    expect(result.path).toEqual(['jpg', 'png', 'gif']);
  });
});

describe('findConversionPath - via canonical intermediate', () => {
  it('routes through canonical (png) when no direct edge exists', () => {
    // Create a graph where webp→gif has no direct edge
    const sparseEdges = [
      { from: 'webp', to: 'png', qualityLoss: 2 }, // webp→canonical
      { from: 'png',  to: 'gif', qualityLoss: 20 }, // canonical→gif
    ];
    const sparseGraph = buildGraph(sparseEdges);

    const result = findConversionPath(sparseGraph, 'webp', 'gif');
    expect(result.found).toBe(true);
    // Path goes webp→png→gif
    expect(result.path).toContain('png'); // went via canonical
    expect(result.totalQualityLoss).toBe(22);
  });
});

describe('findConversionPath - unavailable conversions', () => {
  it('returns found=false when no path exists', () => {
    const emptyGraph: ConversionGraph = new Map();
    const result = findConversionPath(emptyGraph, 'jpg', 'mp4');
    expect(result.found).toBe(false);
    expect(result.path).toHaveLength(0);
  });

  it('returns found=false for disconnected formats', () => {
    // Graph only has image formats but we ask for audio
    const result = findConversionPath(GRAPH, 'jpg', 'mp3');
    expect(result.found).toBe(false);
  });
});

describe('findConversionPath - path optimality', () => {
  it('chooses lower-loss path over shorter path', () => {
    // Two paths from a→c:
    //   a→c directly (qualityLoss=50)
    //   a→b→c (qualityLoss=5+5=10)
    const edges = [
      { from: 'a', to: 'c', qualityLoss: 50 },
      { from: 'a', to: 'b', qualityLoss: 5 },
      { from: 'b', to: 'c', qualityLoss: 5 },
    ];
    const g = buildGraph(edges);
    const result = findConversionPath(g, 'a', 'c');
    expect(result.found).toBe(true);
    expect(result.totalQualityLoss).toBe(10);
    expect(result.path).toEqual(['a', 'b', 'c']);
  });
});
