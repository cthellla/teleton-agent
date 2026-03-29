/**
 * Plugin cron scheduler — interval-based job execution with SQLite persistence.
 *
 * Jobs are registered by plugins during tools() and persist their
 * lastRunAt timestamp across restarts so missed runs can be detected.
 *
 * Lifecycle:
 *   1. Plugin calls sdk.cron.register() — job is stored but timer not started
 *   2. Plugin-loader calls cronManager._start() — all timers activate
 *   3. On shutdown, cronManager._stopAll() — all timers cleared
 */

import type Database from "better-sqlite3";
import type { CronSDK, CronJob, CronJobOptions, PluginLogger } from "@teleton-agent/sdk";

const CRON_TABLE = "_cron_jobs";
const MIN_INTERVAL = 1000;

interface InternalJob {
  id: string;
  intervalMs: number;
  runMissed: boolean;
  callback: () => Promise<void>;
  lastRunAt: number | null;
  timer: ReturnType<typeof setInterval> | null;
}

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CRON_TABLE} (
      id          TEXT PRIMARY KEY,
      interval_ms INTEGER NOT NULL,
      run_missed  INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER
    )
  `);
}

export class CronManager {
  private jobs = new Map<string, InternalJob>();
  private started = false;
  private stopped = false;
  private db: Database.Database;
  private log: PluginLogger;

  private stmtUpsert;
  private stmtDelete;
  private stmtGetLastRun;
  private stmtUpdateLastRun;

  constructor(db: Database.Database, log: PluginLogger) {
    this.db = db;
    this.log = log;
    ensureTable(db);
    this.stmtUpsert = db.prepare(
      `INSERT OR REPLACE INTO ${CRON_TABLE} (id, interval_ms, run_missed, last_run_at)
       VALUES (?, ?, ?, ?)`
    );
    this.stmtDelete = db.prepare(`DELETE FROM ${CRON_TABLE} WHERE id = ?`);
    this.stmtGetLastRun = db.prepare(`SELECT last_run_at FROM ${CRON_TABLE} WHERE id = ?`);
    this.stmtUpdateLastRun = db.prepare(`UPDATE ${CRON_TABLE} SET last_run_at = ? WHERE id = ?`);
  }

  register(id: string, opts: CronJobOptions, callback: () => Promise<void>): void {
    if (this.stopped) {
      throw new Error("CronManager is stopped — cannot register new jobs");
    }
    if (!id || typeof id !== "string") {
      throw new Error("Cron job id must be a non-empty string");
    }
    if (!opts || typeof opts.every !== "number" || opts.every < MIN_INTERVAL) {
      throw new Error(`Cron interval must be at least ${MIN_INTERVAL}ms`);
    }

    // Load persisted lastRunAt if this job was registered before
    const row = this.stmtGetLastRun.get(id) as { last_run_at: number | null } | undefined;
    const lastRunAt = row?.last_run_at ?? null;

    const job: InternalJob = {
      id,
      intervalMs: opts.every,
      runMissed: opts.runMissed ?? false,
      callback,
      lastRunAt,
      timer: null,
    };

    // If re-registering, clear previous timer
    const existing = this.jobs.get(id);
    if (existing?.timer) {
      clearInterval(existing.timer);
    }

    this.jobs.set(id, job);

    // Persist metadata
    this.stmtUpsert.run(id, job.intervalMs, job.runMissed ? 1 : 0, lastRunAt);

    // If already started, activate timer immediately
    if (this.started) {
      this.activateJob(job);
    }
  }

  unregister(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }

    this.jobs.delete(id);
    this.stmtDelete.run(id);
    return true;
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values()).map((j) => this.toSnapshot(j));
  }

  get(id: string): CronJob | undefined {
    const job = this.jobs.get(id);
    return job ? this.toSnapshot(job) : undefined;
  }

  /** Activate all registered timers. Called by plugin-loader during start(). */
  _start(): void {
    if (this.started) return;
    this.started = true;

    for (const job of this.jobs.values()) {
      this.activateJob(job);
    }
  }

  /** Clear all timers. Called by plugin-loader during stop(). */
  _stopAll(): void {
    this.stopped = true;
    this.started = false;

    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearInterval(job.timer);
        job.timer = null;
      }
    }
  }

  private activateJob(job: InternalJob): void {
    // Check for missed run
    if (job.runMissed && job.lastRunAt !== null) {
      const overdue = Date.now() - (job.lastRunAt + job.intervalMs);
      if (overdue > 0) {
        this.log.info(
          `Cron job "${job.id}" missed run (${Math.round(overdue / 1000)}s overdue), firing`
        );
        this.executeJob(job);
      }
    }

    const timer = setInterval(() => this.executeJob(job), job.intervalMs);
    timer.unref();
    job.timer = timer;

    this.log.info(`Cron job "${job.id}" activated (every ${job.intervalMs / 1000}s)`);
  }

  private executeJob(job: InternalJob): void {
    Promise.resolve()
      .then(() => job.callback())
      .then(() => {
        job.lastRunAt = Date.now();
        this.persistLastRun(job);
      })
      .catch((err) => {
        this.log.error(`Cron job "${job.id}" failed: ${err instanceof Error ? err.message : err}`);
        // Still update lastRunAt to prevent infinite retry loops
        job.lastRunAt = Date.now();
        this.persistLastRun(job);
      });
  }

  private persistLastRun(job: InternalJob): void {
    try {
      this.stmtUpdateLastRun.run(job.lastRunAt, job.id);
    } catch (err) {
      this.log.error(
        `Failed to persist lastRunAt for "${job.id}": ${err instanceof Error ? err.message : err}`
      );
    }
  }

  private toSnapshot(job: InternalJob): CronJob {
    return {
      id: job.id,
      intervalMs: job.intervalMs,
      runMissed: job.runMissed,
      lastRunAt: job.lastRunAt,
      nextRunAt: job.timer && job.lastRunAt !== null ? job.lastRunAt + job.intervalMs : null,
      running: job.timer !== null,
    };
  }
}

export function createCronSDK(
  db: Database.Database,
  log: PluginLogger
): { sdk: CronSDK; manager: CronManager } {
  const manager = new CronManager(db, log);

  const sdk: CronSDK = Object.freeze({
    register: (id: string, opts: CronJobOptions, callback: () => Promise<void>) =>
      manager.register(id, opts, callback),
    unregister: (id: string) => manager.unregister(id),
    list: () => manager.list(),
    get: (id: string) => manager.get(id),
  });

  return { sdk, manager };
}
