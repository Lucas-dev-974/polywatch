#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

function secret(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

console.log('# Paste into .env (replace existing placeholder values)');
console.log(`JWT_SECRET=${secret()}`);
console.log(`JWT_REFRESH_SECRET=${secret()}`);
console.log(`SERVICE_TOKEN=${secret()}`);
console.log(`MASTER_ENCRYPTION_KEY=${secret()}`);
console.log('');
console.log('# After rotating MASTER_ENCRYPTION_KEY, re-enter CLOB credentials in the UI.');
