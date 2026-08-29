export interface ArgSpec<T> {
  readonly flags?: Readonly<Record<string, keyof T & string>>;
  readonly negated?: Readonly<Record<string, keyof T & string>>;
  readonly values?: Readonly<Record<string, keyof T & string>>;
  readonly counts?: Readonly<Record<string, keyof T & string>>;
  readonly optional?: Readonly<Record<string, keyof T & string>>;
}

export function parseCountValue(raw: string): unknown {
  if (raw === 'all') return 'all';
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export function parseArgs<T extends object>(argv: readonly string[], spec: ArgSpec<T>, initial: T): T {
  const opts = initial as Record<string, unknown>;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    const optional = spec.optional?.[a];
    if (optional !== undefined) {
      const next = argv[i + 1];
      opts[optional] = next !== undefined && !next.startsWith('-') ? argv[++i]! : '';
      continue;
    }

    const flag = spec.flags?.[a];
    if (flag !== undefined) {
      opts[flag] = true;
      continue;
    }

    const negated = spec.negated?.[a];
    if (negated !== undefined) {
      opts[negated] = false;
      continue;
    }

    const count = spec.counts?.[a];
    if (count !== undefined) {
      const val = argv[++i];
      if (val === undefined) throw new Error(`option ${a} needs a value`);
      opts[count] = parseCountValue(val);
      continue;
    }

    const value = spec.values?.[a];
    if (value === undefined) throw new Error(`unknown argument: ${a}`);
    const val = argv[++i];
    if (val === undefined) throw new Error(`option ${a} needs a value`);
    opts[value] = val;
  }

  return initial;
}
