import { buildApp } from './app';
import { getEnv } from './config/env';

async function start() {
  const env = getEnv();
  const app = await buildApp({ logger: true });
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
start();
