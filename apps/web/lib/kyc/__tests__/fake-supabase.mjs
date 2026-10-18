/**
 * In-memory stand-in for @/lib/supabase-server in tests. Supports the small
 * query surface the KYC and ramp services use. `fakeDb.failTables` makes a
 * table return an error, to prove the callers fail closed.
 */
import { randomUUID } from "node:crypto";

export const fakeDb = {
  tables: new Map(),
  failTables: new Set(),
  reset() {
    this.tables.clear();
    this.failTables.clear();
  },
  rows(table) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table);
  },
};

class Query {
  constructor(table) {
    this.table = table;
    this.op = "select";
    this.filters = [];
    this.payload = null;
    this.countMode = null;
    this.head = false;
    this.mode = null;
    this.limitN = null;
    this.orderBy = null;
    this.conflict = null;
  }
  select(_columns, options) {
    if (this.op === "select" && options) {
      this.countMode = options.count ?? null;
      this.head = Boolean(options.head);
    }
    return this;
  }
  insert(value) { this.op = "insert"; this.payload = value; return this; }
  upsert(value, options) { this.op = "upsert"; this.payload = value; this.conflict = options?.onConflict ?? "id"; return this; }
  update(value) { this.op = "update"; this.payload = value; return this; }
  delete() { this.op = "delete"; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  neq(column, value) { this.filters.push((row) => row[column] !== value); return this; }
  gte(column, value) { this.filters.push((row) => row[column] >= value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  order(column, options) { this.orderBy = [column, options?.ascending !== false]; return this; }
  limit(n) { this.limitN = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "one"; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }

  run() {
    if (fakeDb.failTables.has(this.table)) return { data: null, error: { message: `boom on ${this.table}` }, count: null };
    const rows = fakeDb.rows(this.table);
    const match = (row) => this.filters.every((f) => f(row));
    const stamp = () => new Date().toISOString();
    let out;
    if (this.op === "insert" || this.op === "upsert") {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload];
      out = values.map((value) => {
        if (this.op === "upsert") {
          const keys = this.conflict.split(",");
          const existing = rows.find((row) => keys.every((key) => row[key] === value[key]));
          if (existing) return Object.assign(existing, value);
        }
        const row = { id: randomUUID(), created_at: stamp(), ...value };
        rows.push(row);
        return row;
      });
    } else if (this.op === "update") {
      out = rows.filter(match).map((row) => Object.assign(row, this.payload));
    } else if (this.op === "delete") {
      out = rows.filter(match);
      fakeDb.tables.set(this.table, rows.filter((row) => !match(row)));
    } else {
      out = rows.filter(match);
      if (this.orderBy) {
        const [column, asc] = this.orderBy;
        out = [...out].sort((a, b) => (a[column] > b[column] ? 1 : -1) * (asc ? 1 : -1));
      }
      if (this.limitN != null) out = out.slice(0, this.limitN);
    }
    const copy = out.map((row) => structuredClone(row));
    if (this.countMode) return { data: this.head ? null : copy, count: copy.length, error: null };
    if (this.mode === "maybe") return { data: copy[0] ?? null, error: null };
    if (this.mode === "one") {
      return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: "not exactly one row" } };
    }
    return { data: copy, error: null };
  }
}

export function createSupabaseAdminClient() {
  return {
    from: (table) => new Query(table),
    rpc: async () => ({ data: true, error: null }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null }) }) },
  };
}
