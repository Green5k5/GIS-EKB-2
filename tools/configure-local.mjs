import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadEnv } from '../server/env.js';

loadEnv();
if (!process.env.ADMIN_KEY) {
  const key = crypto.randomBytes(32).toString('base64url');
  const file = fs.openSync('.env', 'a', 0o600);
  try {
    fs.fchmodSync(file, 0o600);
    fs.appendFileSync(file, `\nADMIN_KEY=${key}\n`, 'utf8');
  } finally {
    fs.closeSync(file);
  }
  console.log('Создан ключ администратора в .env (ADMIN_KEY).');
}
