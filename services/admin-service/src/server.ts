import { buildApp } from './app';
import { getEnv } from './config/env';

const start = async () => {
  const app = await buildApp({ logger: true });
  await app.listen({ port: getEnv().PORT, host: '0.0.0.0' });
};

start().catch(console.error);
