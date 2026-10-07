import { promises as fs } from 'node:fs'
import path from 'node:path'
import { HttpError } from './permissions'
import { MAX_FILE_SIZE } from './constants'

const UPLOAD_ROOT = process.env.UPLOAD_DIR || 'uploads'
const ABS_ROOT = path.resolve(process.cwd(), UPLOAD_ROOT)

// Allow-list MIME types (basic). Real validation also checks magic bytes.
export function isPlanMime(mime: string): boolean {
  return ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(mime.toLowerCase())
}

export function isAttachmentMime(mime: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'].includes(mime.toLowerCase())
}

/** Validates file size and MIME against policy. */
export function validateUpload(file: { name: string; type: string; size: number }, kind: 'plan' | 'attachment'): void {
  if (file.size <= 0) throw new HttpError(400, 'empty_file', 'Uploaded file is empty.')
  if (file.size > MAX_FILE_SIZE) throw new HttpError(413, 'file_too_large', `File exceeds ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)}MB limit.`)
  const allowed = kind === 'plan' ? isPlanMime(file.type) : isAttachmentMime(file.type)
  if (!allowed) throw new HttpError(415, 'unsupported_media_type', `MIME type "${file.type}" is not allowed for ${kind} uploads.`)
}

// Magic-byte signatures for additional safety (defends against MIME spoofing).
const SIG_PDF = Buffer.from('%PDF-', 'latin1')
const SIG_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const SIG_JPG = Buffer.from([0xff, 0xd8, 0xff])
const SIG_GIF = Buffer.from('GIF87a', 'latin1')
const SIG_GIF2 = Buffer.from('GIF89a', 'latin1')
const SIG_WEBP = Buffer.from('RIFF', 'latin1')

export function matchesMagic(buf: Buffer, mime: string): boolean {
  if (mime === 'application/pdf') return buf.subarray(0, 5).equals(SIG_PDF)
  if (mime === 'image/png') return buf.subarray(0, 4).equals(SIG_PNG)
  if (mime === 'image/jpeg') return buf.subarray(0, 3).equals(SIG_JPG)
  if (mime === 'image/gif') return buf.subarray(0, 6).equals(SIG_GIF) || buf.subarray(0, 6).equals(SIG_GIF2)
  if (mime === 'image/webp') return buf.subarray(0, 4).equals(SIG_WEBP) && buf.subarray(8, 12).toString('latin1') === 'WEBP'
  if (mime === 'text/plain') return true // tolerate
  return false
}

/** Writes file bytes to disk under uploads/projects/{projectId}/{subdir}/{filename}. */
export async function writeFileToDisk(opts: {
  projectId: string
  subdir: string
  fileName: string
  bytes: Buffer
}): Promise<string> {
  const dir = path.join(ABS_ROOT, 'projects', opts.projectId, opts.subdir)
  await fs.mkdir(dir, { recursive: true })
  // Avoid path traversal / collisions: prefix with timestamp + cuid-ish
  const safe = opts.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const finalName = `${Date.now()}-${safe}`
  const fullPath = path.join(dir, finalName)
  await fs.writeFile(fullPath, opts.bytes)
  // Return relative path (stored in DB).
  return path.join('projects', opts.projectId, opts.subdir, finalName).split(path.sep).join('/')
}

/** Resolves a stored relative path to absolute. Throws if the resolved path escapes the uploads root. */
export function resolveStoredPath(relPath: string): string {
  const abs = path.resolve(ABS_ROOT, relPath)
  const rel = path.relative(ABS_ROOT, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new HttpError(400, 'invalid_path', 'File path is invalid.')
  }
  return abs
}

/** Reads file bytes from disk for streaming. */
export async function readFileFromDisk(relPath: string): Promise<Buffer> {
  const abs = resolveStoredPath(relPath)
  try {
    return await fs.readFile(abs)
  } catch {
    throw new HttpError(404, 'file_not_found', 'File not found on disk.')
  }
}

/** Deletes a stored file (best-effort; never throws to user). */
export async function deleteFileFromDisk(relPath: string): Promise<void> {
  try {
    const abs = resolveStoredPath(relPath)
    await fs.unlink(abs)
  } catch {
    // swallow
  }
}

export const UPLOAD_ABS_ROOT = ABS_ROOT
