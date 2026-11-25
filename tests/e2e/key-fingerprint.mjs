// How the installer e2e suites check that an API key arrived without writing
// it down: the fake `claude` (fake-claude.mjs) records only this fingerprint,
// and the suites compute the same one for the key they expect. It is scrypt,
// not a bare SHA-256, so what lands on disk is not a fast hash of a secret.
import { scryptSync } from 'node:crypto';

const SALT = 'mcp-automem-e2e-fake-claude';

export const keyFingerprint = (value) => scryptSync(value, SALT, 32).toString('hex');
