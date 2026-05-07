import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";

/**
 * Write `text` to `target` atomically. Backs the original up to
 * `<target>.bak.<unix-ts>` if it exists, writes to a sibling tmp file,
 * fsyncs the tmp file, then renames over the target.
 *
 * Returns the backup path (undefined if there was nothing to back up).
 *
 * Both tmp file and backup live in the same directory as `target` so the
 * rename is atomic even on case-insensitive filesystems and so we don't
 * cross volume boundaries (which would degrade rename to copy+unlink).
 */
export function atomicWrite(target: string, text: string): string | undefined {
  const dir = dirname(target);
  const base = basename(target);
  const ts = Date.now();
  let backup: string | undefined;
  if (existsSync(target)) {
    backup = join(dir, `${base}.bak.${ts}`);
    copyFileSync(target, backup);
  }

  const tmp = join(dir, `.${base}.tmp.${ts}.${process.pid}`);
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  try {
    renameSync(tmp, target);
  } catch (err) {
    // Cleanup tmp on failure to avoid orphaned files.
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }

  return backup;
}
