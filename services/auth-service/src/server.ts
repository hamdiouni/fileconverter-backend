import { buildApp } from './app';
import { getEnv } from './config/env';

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp({ logger: true });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`Auth service running on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
