import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where uploaded contract files live. Files are always private: nothing here
 * hands out a public URL, and reads go through the server after an org check.
 */
export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

/** Keys are built by the server from UUIDs, but refuse anything path-like anyway. */
function assertSafeKey(key: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) || key.includes("..")) {
    throw new Error("Invalid storage key");
  }
}

function vercelBlobStorage(): FileStorage {
  return {
    async put(key, bytes, contentType) {
      assertSafeKey(key);
      const { put } = await import("@vercel/blob");
      await put(key, Buffer.from(bytes), {
        access: "private",
        contentType,
        addRandomSuffix: false,
      });
    },
    async get(key) {
      assertSafeKey(key);
      const { get } = await import("@vercel/blob");
      const result = await get(key, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200)
        throw new Error("File not found in storage");
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async delete(key) {
      assertSafeKey(key);
      const { del } = await import("@vercel/blob");
      await del(key);
    },
  };
}

/** Development only: keeps files under ./.data so the app runs with no Blob store. */
function localDiskStorage(root: string): FileStorage {
  const resolve = (key: string) => {
    assertSafeKey(key);
    return path.join(root, ...key.split("/"));
  };
  return {
    async put(key, bytes) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    async get(key) {
      return new Uint8Array(await readFile(resolve(key)));
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

export function getStorage(): FileStorage {
  if (process.env.BLOB_READ_WRITE_TOKEN) return vercelBlobStorage();
  if (process.env.NODE_ENV !== "production") {
    return localDiskStorage(path.join(process.cwd(), ".data", "uploads"));
  }
  throw new Error(
    "BLOB_READ_WRITE_TOKEN is not set. Add a Vercel Blob store to the project.",
  );
}
