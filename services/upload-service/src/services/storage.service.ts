/**
 * Storage service abstraction — wraps S3/MinIO operations.
 * Designed to be easily mockable in tests.
 */
export interface StorageService {
  generatePresignedUploadUrl(key: string, contentType: string, expiresIn: number): Promise<string>;
  generatePresignedDownloadUrl(key: string, expiresIn: number): Promise<string>;
  fileExists(key: string): Promise<boolean>;
  deleteFile(key: string): Promise<void>;
  getFileSize(key: string): Promise<number>;
}

export class S3StorageService implements StorageService {
  private s3: any;
  private bucket: string;

  constructor(private config: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.bucket = config.bucket;
  }

  private publicS3: any;

  private async getS3() {
    if (!this.s3) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.s3 = new S3Client({
        endpoint: this.config.endpoint,
        region: this.config.region,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
        forcePathStyle: true,
      });
    }
    return this.s3;
  }

  private async getPublicS3() {
    if (!this.publicS3) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000';
      this.publicS3 = new S3Client({
        endpoint: publicEndpoint,
        region: this.config.region,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
        forcePathStyle: true,
      });
    }
    return this.publicS3;
  }

  async generatePresignedUploadUrl(key: string, contentType: string, expiresIn: number): Promise<string> {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await this.getPublicS3();
    return getSignedUrl(s3, new PutObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async generatePresignedDownloadUrl(key: string, expiresIn: number): Promise<string> {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await this.getPublicS3();
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async fileExists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await this.getS3();
    try {
      await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await this.getS3();
    await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getFileSize(key: string): Promise<number> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await this.getS3();
    const result = await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return result.ContentLength ?? 0;
  }
}
