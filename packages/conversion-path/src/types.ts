/**
 * Shared types for the conversion-path package.
 */

/** A conversion edge from one format to another with an associated quality-loss score */
export interface ConversionEdge {
  from: string;
  to: string;
  /** 0 = lossless, 100 = total quality loss */
  qualityLoss: number;
}

/** A conversion graph keyed by source format */
export type ConversionGraph = Map<string, ConversionEdge[]>;

/** Result of path-finding */
export interface PathResult {
  found: boolean;
  path: string[];        // format names in order, e.g. ["jpg", "png", "webp"]
  totalQualityLoss: number;
  viaCanonical: boolean; // true when the path went through a canonical intermediate
}
