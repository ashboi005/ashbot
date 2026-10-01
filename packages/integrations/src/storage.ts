import { S3Client } from "bun";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

export type Storage = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  // A direct (presigned) URL, or null when files must be streamed through the app.
  url(key: string, opts?: { expiresIn?: number }): Promise<string | null>;
};

function safeKey(key: string): string {
  const normalized = normalize(key);
  if (isAbsolute(normalized) || normalized.startsWith("..") || normalized.split(sep).includes("..")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return normalized;
}

export function createLocalStorage(dir: string): Storage {
  const pathOf = (key: string) => join(dir, safeKey(key));
  return {
    async put(key, data) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      return new Uint8Array(await readFile(pathOf(key)));
    },
    async url() {
      return null;
    },
  };
}

export function createS3Storage(opts: {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}): Storage {
  const client = new S3Client({
    bucket: opts.bucket,
    region: opts.region,
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    endpoint: opts.endpoint,
  });
  return {
    async put(key, data, contentType) {
      await client.write(safeKey(key), data, { type: contentType });
    },
    async get(key) {
      return new Uint8Array(await client.file(safeKey(key)).arrayBuffer());
    },
    async url(key, { expiresIn = 600 } = {}) {
      return client.presign(safeKey(key), { expiresIn, method: "GET" });
    },
  };
}

export type StorageEnv = {
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_ENDPOINT?: string;
  UPLOADS_DIR?: string;
};

export function storageFromEnv(env: StorageEnv, defaultDir: string): Storage {
  if (!env.S3_BUCKET) return createLocalStorage(env.UPLOADS_DIR || defaultDir);
  const missing = (["S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const).filter((key) => !env[key]);
  if (missing.length > 0) throw new Error(`S3_BUCKET is set but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing.`);
  return createS3Storage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    endpoint: env.S3_ENDPOINT || undefined,
  });
}
