import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
}

const UNKNOWN: PackageIdentity = { name: 'hatch', version: '0.0.0' };

/** Name and version of this package, read from its own package.json. */
export function packageIdentity(): PackageIdentity {
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { name?: string; version?: string };
    return { name: pkg.name ?? UNKNOWN.name, version: pkg.version ?? UNKNOWN.version };
  } catch {
    return UNKNOWN;
  }
}
