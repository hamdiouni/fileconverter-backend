/**
 * E2E test setup.
 *
 * Reads base URLs from environment variables.  If the services are not
 * reachable (e.g. in CI without a running stack), individual tests can be
 * skipped using the `skipIfOffline` helper.
 */
export const BASE_URLS = {
  auth:         process.env['AUTH_SERVICE_URL']         ?? 'http://localhost:3000',
  user:         process.env['USER_SERVICE_URL']         ?? 'http://localhost:3001',
  upload:       process.env['UPLOAD_SERVICE_URL']       ?? 'http://localhost:3002',
  orchestrator: process.env['ORCHESTRATOR_SERVICE_URL'] ?? 'http://localhost:3003',
  billing:      process.env['BILLING_SERVICE_URL']      ?? 'http://localhost:3004',
  notification: process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3005',
  admin:        process.env['ADMIN_SERVICE_URL']        ?? 'http://localhost:3006',
};

export const TEST_JWT_SECRET =
  process.env['JWT_ACCESS_SECRET'] ?? 'test-secret-key-for-testing';
