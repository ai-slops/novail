import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createSeed } from "./seed.mjs";
import { initializeBranches } from "./branch-state.mjs";

export class FileStore {
  #file;
  #state;
  #queue = Promise.resolve();

  constructor(file) {
    this.#file = resolve(file);
  }

  async initialize() {
    let created = false;
    await mkdir(dirname(this.#file), { recursive: true });
    try {
      this.#state = JSON.parse(await readFile(this.#file, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.#state = createSeed();
      created = true;
    }
    const needsMigration = this.#state.branchSchemaVersion !== 1 || this.#state.revisionSchemaVersion !== 2 || !this.#state.branches || this.#state.workspaces.some((project) => !project.branches);
    initializeBranches(this.#state);
    if (created || needsMigration) await this.#save(this.#state);
  }

  async read() {
    await this.#queue;
    return structuredClone(this.#state);
  }

  async transaction(operation) {
    const execute = async () => {
      const working = structuredClone(this.#state);
      const result = await operation(working);
      await this.#save(working);
      this.#state = working;
      return structuredClone(result);
    };
    const pending = this.#queue.then(execute, execute);
    this.#queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #save(state) {
    const temporary = `${this.#file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#file);
  }

  async close() {}
}

export class PostgresStore {
  #connectionString;
  #pool;

  constructor(connectionString) {
    this.#connectionString = connectionString;
  }

  async initialize() {
    const { Pool } = await import("pg");
    this.#pool = new Pool({
      connectionString: this.#connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS novail_state (
        project_key text PRIMARY KEY,
        document jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.#pool.query(
      `INSERT INTO novail_state(project_key, document)
       VALUES ($1, $2::jsonb) ON CONFLICT (project_key) DO NOTHING`,
      ["default", JSON.stringify(createSeed())],
    );
    await this.transaction((state) => { initializeBranches(state); return null; });
  }

  async read() {
    const result = await this.#pool.query(
      "SELECT document FROM novail_state WHERE project_key = $1",
      ["default"],
    );
    return structuredClone(result.rows[0].document);
  }

  async transaction(operation) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        "SELECT document FROM novail_state WHERE project_key = $1 FOR UPDATE",
        ["default"],
      );
      const working = structuredClone(selected.rows[0].document);
      const result = await operation(working);
      await client.query(
        `UPDATE novail_state SET document = $2::jsonb, updated_at = now()
         WHERE project_key = $1`,
        ["default", JSON.stringify(working)],
      );
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.#pool?.end();
  }
}

export const createStore = () => process.env.DATABASE_URL
  ? new PostgresStore(process.env.DATABASE_URL)
  : new FileStore(process.env.NOVAIL_DATA_FILE ?? resolve("app/data/local-state.json"));
