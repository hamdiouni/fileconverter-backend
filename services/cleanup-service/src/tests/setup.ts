process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['S3_ENDPOINT']  = 'http://localhost:9000';
process.env['AWS_ACCESS_KEY_ID']     = 'test';
process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
process.env['CLEANUP_RETENTION_FREE']     = '7';
process.env['CLEANUP_RETENTION_PRO']      = '14';
process.env['CLEANUP_RETENTION_BUSINESS'] = '30';
