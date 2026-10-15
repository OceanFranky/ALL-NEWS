import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [source, destination, root, siteUrl] = process.argv.slice(2);
if (!source || !destination || !root?.startsWith('/') || !siteUrl?.startsWith('http')) throw new Error('Pass source env, destination env, deployment root and site URL');
const retained = readFileSync(source, 'utf8').split('\n').filter(line => /^[A-Z][A-Z0-9_]*=/.test(line) && !/^(DEV_AUTH_|PATH=|NODE_VERSION=|YARN_VERSION=)/.test(line));
const values = new Map(retained.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const postgresPassword = randomBytes(32).toString('hex');
const overrides = {
  NODE_ENV: 'production', SITE_URL: siteUrl, API_HOST: '127.0.0.1', API_PORT: '3001',
  API_BASE_URL: 'http://127.0.0.1:3001', WEB_HOST: '0.0.0.0', WEB_PORT: '3000', TRUST_PROXY: 'false',
  AIHOT_DATA_DIR: `${root}/data`, POSTGRES_PASSWORD: postgresPassword,
  DATABASE_URL: `postgres://aihot:${postgresPassword}@127.0.0.1:15432/all_news`,
  ADMIN_PASSWORD: randomBytes(24).toString('base64url'), SESSION_SECRET: randomBytes(32).toString('hex'),
  IMG_PROXY_SIGN_SECRET: randomBytes(32).toString('hex'), COLLECT_ENABLED: 'true', MODEL_CALLS_ENABLED: 'true',
  FEISHU_CONTENT_PUSH_ENABLED: 'false', FEISHU_INTERNAL_ENABLED: 'false', INDEXNOW_SUBMIT_ENABLED: 'false',
};
for (const [key, value] of Object.entries(overrides)) values.set(key, value);
writeFileSync(destination, [...values].map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
const webKeys = ['NODE_ENV', 'SITE_URL', 'API_BASE_URL', 'WEB_HOST', 'WEB_PORT', 'TRUST_PROXY'];
writeFileSync(join(dirname(destination), 'web.env'), webKeys.map(key => `${key}=${values.get(key)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
console.log('Server environment prepared; credentials are not printed.');
