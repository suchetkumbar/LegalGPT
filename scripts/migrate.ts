/**
 * Applies the SQL migrations in ./drizzle to DATABASE_URL, then checks that
 * the result is usable. Used locally (`npm run db:migrate`) and in the Vercel
 * build.
 *
 * This replaces `drizzle-kit migrate`, which can exit without printing either
 * a success line or the error when it runs over the Neon driver. A migration
 * that fails quietly is worse than one that fails loudly, so this script
 * always says what happened and exits non-zero on any problem.
 */
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

config({ path: ".env.local", quiet: true });

const EXPECTED_TABLES = [
  "audit_log",
  "clauses",
  "contracts",
  "entities",
  "jobs",
  "orgs",
  "users",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (expected in .env.local)");

  const pool = new Pool({ connectionString: url });
  try {
    console.log("Applying migrations from ./drizzle ...");
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");

    const problems: string[] = [];

    const tables = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables
       where schemaname = 'public' and tablename = any($1) order by tablename`,
      [EXPECTED_TABLES],
    );
    for (const name of EXPECTED_TABLES) {
      const table = tables.rows.find((row) => row.tablename === name);
      if (!table) problems.push(`table "${name}" is missing`);
      else if (!table.rowsecurity)
        problems.push(`row-level security is off on "${name}"`);
    }

    const extension = await pool.query(
      `select 1 from pg_extension where extname = 'vector'`,
    );
    if (extension.rowCount === 0)
      problems.push("the pgvector extension is not installed");

    // Every request-scoped query switches into app_user, so prove that works.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role app_user");
      const who = await client.query<{ current_user: string }>("select current_user");
      if (who.rows[0]?.current_user !== "app_user") {
        problems.push("could not switch to the app_user role");
      }
    } catch (error) {
      problems.push(
        `could not switch to the app_user role: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }

    if (problems.length > 0) {
      throw new Error(`Database check failed:\n  - ${problems.join("\n  - ")}`);
    }

    console.log(
      `Database check passed: ${EXPECTED_TABLES.join(", ")} exist with row-level security, ` +
        "pgvector is installed, and the app_user role is usable.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // Never print the connection string, even if a driver puts it in a message.
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /postgres(ql)?:\/\/\S+/g,
    "[connection string hidden]",
  );
  console.error(`\nMigration failed: ${message}`);
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause) console.error(`Cause: ${cause instanceof Error ? cause.message : cause}`);
  process.exit(1);
});
