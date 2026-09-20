/**
 * Status of a conversion job
 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Format family categories for routing to appropriate workers
 */
export type FormatFamily = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'cad' | 'font';

/**
 * Options that can be passed with a conversion request
 */
export interface ConversionOptions {
  quality?: number;
  width?: number;
  height?: number;
  preserveMetadata?: boolean;
  codec?: string;
  bitrate?: string;
  pages?: string;
  watermark?: string;
  [key: string]: unknown;
}

/**
 * Core conversion job record (matches database conversion_jobs table)
 */
export interface ConversionJob {
  id: string;
  userId: string;
  sourceFileId: string;
  sourceFormat: string;
  targetFormat: string;
  status: JobStatus;
  priority: number;
  options: ConversionOptions;
  formatFamily: FormatFamily;
  conversionPath: string[];
  resultFileId: string | null;
  errorMessage: string | null;
  webhookUrl: string | null;
  idempotencyKey: string | null;
  workerId: string | null;
  retryCount: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

/**
 * Metadata for uploaded and converted files
 */
export interface FileMetadata {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  size: number;
  contentType: string;
  storageKey: string;
  virusScanStatus: 'pending' | 'clean' | 'infected';
  uploadStatus: 'pending' | 'uploaded' | 'expired';
  uploadedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Request to initiate a file upload
 */
export interface UploadRequest {
  uploadId: string;
  presignedUrl: string;
  expiresIn: number;
  fields: Record<string, string>;
}

/**
 * Result after completing an upload
 */
export interface UploadResult {
  fileId: string;
  filename: string;
  size: number;
  contentType: string;
  storageKey: string;
  uploadedAt: Date;
  virusScanStatus: 'pending' | 'clean' | 'infected';
}

/**
 * Conversion path information returned by path validation
 */
export interface ConversionPath {
  valid: boolean;
  path: string[];
  estimatedTime: number;
  reason?: string;
}

/**
 * Result produced by a worker after completing a job
 */
export interface JobResult {
  resultFileId: string;
  outputSize: number;
  processingTime: number;
  workerId: string;
}
