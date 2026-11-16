import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

/**
 * Object storage port. File bytes never live in PostgreSQL; the database holds
 * metadata, checksum and the object key. Phase 01 ships a private local-disk
 * adapter (outside any web root, never served statically). An S3 adapter with
 * SSE-KMS implements the same interface for deployed environments.
 */
export interface ObjectStorage {
  readonly provider: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

const KEY_RE = /^[a-z0-9][a-z0-9/_-]{10,200}$/;

@Injectable()
export class LocalDiskStorage implements ObjectStorage {
  readonly provider = 'local';
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = isAbsolute(env.DOCUMENT_STORAGE_DIR) ? env.DOCUMENT_STORAGE_DIR : resolve(process.cwd(), env.DOCUMENT_STORAGE_DIR);
  }

  /** Keys are server-generated, but are still validated to rule out path traversal. */
  private pathFor(key: string): string {
    if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Invalid object key');
    const full = normalize(join(this.root, key));
    if (!full.startsWith(normalize(this.root) + sep)) throw new Error('Invalid object key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
