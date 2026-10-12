import pg from "pg";

export type Db = pg.Pool;

export const PRODUCTS_TABLE = "products";
export const CARTS_TABLE = "carts";
export const EXPERIMENTS_TABLE = "experiments";
export const RUNS_TABLE = "runs";
export const EVENTS_TABLE = "events";
export const KEYS_TABLE = "keys";

export type DbTable =
  | typeof PRODUCTS_TABLE
  | typeof CARTS_TABLE
  | typeof EXPERIMENTS_TABLE
  | typeof RUNS_TABLE
  | typeof EVENTS_TABLE
  | typeof KEYS_TABLE;

const tables: DbTable[] = [
  PRODUCTS_TABLE,
  CARTS_TABLE,
  EXPERIMENTS_TABLE,
  RUNS_TABLE,
  EVENTS_TABLE,
  KEYS_TABLE,
];

const tableSet = new Set<string>(tables);

export function createDb(): Db {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString && process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is not set. Connect the agentshelf-db Postgres database to this service in Render.",
    );
  }
  return new pg.Pool({
    connectionString: connectionString ?? "postgres://postgres:postgres@127.0.0.1:5432/agentshelf",
  });
}

export async function ensureSchema(db: Db) {
  for (const table of tables) {
    await db.query(
      `create table if not exists ${table} (id text primary key, doc jsonb not null)`,
    );
  }
  await db.query(
    `create index if not exists runs_experiment_id_idx on ${RUNS_TABLE} ((doc->>'experiment_id'))`,
  );
  await db.query(
    `create index if not exists events_run_id_idx on ${EVENTS_TABLE} ((doc->>'runId'))`,
  );
}

export async function getDoc<T>(
  db: Db,
  table: DbTable,
  id: string,
): Promise<T | null> {
  assertTable(table);
  const result = await db.query<{ doc: T }>(
    `select doc from ${table} where id = $1`,
    [id],
  );
  return result.rows[0]?.doc ?? null;
}

export async function putDoc(
  db: Db,
  table: DbTable,
  id: string,
  doc: unknown,
) {
  assertTable(table);
  await db.query(
    `insert into ${table} (id, doc) values ($1, $2::jsonb) on conflict (id) do update set doc = excluded.doc`,
    [id, JSON.stringify(doc)],
  );
}

export async function patchDoc(
  db: Db,
  table: DbTable,
  id: string,
  partial: Record<string, unknown>,
) {
  assertTable(table);
  await db.query(
    `update ${table} set doc = doc || $2::jsonb where id = $1`,
    [id, JSON.stringify(partial)],
  );
}

export async function deleteDoc(db: Db, table: DbTable, id: string) {
  assertTable(table);
  await db.query(`delete from ${table} where id = $1`, [id]);
}

export interface FindOptions {
  where?: Record<string, unknown>;
  anyOf?: [field: string, values: string[]];
  orderBy?: string;
  limit?: number;
}

export async function findDocs<T>(
  db: Db,
  table: DbTable,
  opts: FindOptions = {},
): Promise<T[]> {
  assertTable(table);
  const { clauses, values } = buildFilters(opts);
  let query = `select doc from ${table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""}`;
  if (opts.orderBy) {
    assertFieldName(opts.orderBy);
    query += ` order by doc->>'${opts.orderBy}' asc`;
  }
  if (opts.limit !== undefined) {
    if (!Number.isInteger(opts.limit) || opts.limit < 0) {
      throw new Error("Database query limit must be a non-negative integer.");
    }
    values.push(opts.limit);
    query += ` limit $${values.length}`;
  }
  const result = await db.query<{ doc: T }>(query, values);
  return result.rows.map((row) => row.doc);
}

export async function countDocs(
  db: Db,
  table: DbTable,
  opts: Omit<FindOptions, "orderBy" | "limit"> = {},
): Promise<number> {
  assertTable(table);
  const { clauses, values } = buildFilters(opts);
  const result = await db.query<{ count: string }>(
    `select count(*) from ${table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""}`,
    values,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function buildFilters(opts: Pick<FindOptions, "where" | "anyOf">) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (opts.where && Object.keys(opts.where).length > 0) {
    values.push(JSON.stringify(opts.where));
    clauses.push(`doc @> $${values.length}::jsonb`);
  }
  if (opts.anyOf) {
    const [field, anyValues] = opts.anyOf;
    assertFieldName(field);
    values.push(anyValues);
    clauses.push(`doc->>'${field}' = any($${values.length}::text[])`);
  }
  return { clauses, values };
}

function assertFieldName(field: string) {
  if (!/^[a-z_A-Z]+$/.test(field)) {
    throw new Error(`Invalid database document field: ${field}`);
  }
}

function assertTable(table: DbTable) {
  if (!tableSet.has(table)) {
    throw new Error(`Invalid database table: ${table}`);
  }
}
