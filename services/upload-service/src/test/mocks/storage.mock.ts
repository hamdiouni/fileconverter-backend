import type { StorageService } from '../../services/storage.service';

export class InMemoryStorageService implements StorageService {
  files: Map<string, { size: number }> = new Map();

  async generatePresignedUploadUrl(key: string, _contentType: string, _expiresIn: number): Promise<string> {
    return `https://mock-s3.example.com/${key}?presigned=upload`;
  }

  async generatePresignedDownloadUrl(key: string, _expiresIn: number): Promise<string> {
    return `https://mock-s3.example.com/${key}?presigned=download`;
  }

  async fileExists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async deleteFile(key: string): Promise<void> {
    this.files.delete(key);
  }

  async getFileSize(key: string): Promise<number> {
    return this.files.get(key)?.size ?? 0;
  }

  /** Simulate a file being uploaded directly to storage */
  simulateUpload(key: string, size: number): void {
    this.files.set(key, { size });
  }

  reset() { this.files.clear(); }
}
