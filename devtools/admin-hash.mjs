// Make the hash for a new admin password (the game only stores this salted SHA-256, never the password).
// Usage: node devtools/admin-hash.mjs "my new password"
// Then set it as an environment variable before building / deploying:
//   local:  create .env.local with  VITE_ADMIN_HASH=<hash>
//   Vercel: Project → Settings → Environment Variables → VITE_ADMIN_HASH = <hash>, then redeploy
import { createHash } from 'node:crypto';
const pw = process.argv[2];
if (!pw) { console.error('Usage: node devtools/admin-hash.mjs "<password>"'); process.exit(1); }
console.log(`VITE_ADMIN_HASH=${createHash('sha256').update('skyward-parkour/admin:' + pw, 'utf8').digest('hex')}`);
