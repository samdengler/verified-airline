// Writes public/one-id-relay.json, the One ID relay's address the app reads when a
// traveler presents from a phone.  A build carries none, so its panels say the relay
// is not set up; scripts/publish-site.sh writes the deployed relay's address over it.
// Under `npm start`, ONE_ID_RELAY_URL names a relay to use, whose CORS allows
// http://localhost:4200.
//
//   ONE_ID_RELAY_URL=https://<api>.execute-api.us-east-1.amazonaws.com npm start
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.env.ONE_ID_RELAY_URL?.trim() || null;
if (url && !/^https?:\/\/[^/]+/.test(url)) throw new Error(`ONE_ID_RELAY_URL is not an address: ${url}`);
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/one-id-relay.json', import.meta.url), `${JSON.stringify({ url })}\n`);
