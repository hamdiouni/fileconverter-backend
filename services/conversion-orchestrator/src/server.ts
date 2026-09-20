import { buildApp } from './app';
import { getEnv } from './config/env';

const start = async () => {
  const app = await buildApp({ logger: true });
  const env = getEnv();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
};

start().catch(console.error);
