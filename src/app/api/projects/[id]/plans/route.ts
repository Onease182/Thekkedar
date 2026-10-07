import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  withErrors,
  requireAuth,
  requireProjectMember,
  requireWrite,
  HttpError,
} from '@/lib/server/permissions'
import {
  validateUpload,
  matchesMagic,
  writeFileToDisk,
} from '@/lib/server/storage'
import { toIso } from '@/lib/server/json'

interface PlanWithUploader {
  id: string
  projectId: string
  title: string
  description: string | null
  fileName: string
  fileSize: number
  mimeType: string
  uploadedById: string
  uploader?: { fullName: string } | null
  createdAt: Date
  updatedAt: Date
}

function serializePlan(p: PlanWithUploader) {
  return {
    id: p.id,
    projectId: p.projectId,
    title: p.title,
    description: p.description,
    fileName: p.fileName,
    fileSize: p.fileSize,
    mimeType: p.mimeType,
    uploadedById: p.uploadedById,
    uploadedByName: p.uploader?.fullName ?? '',
    createdAt: toIso(p.createdAt)!,
    updatedAt: toIso(p.updatedAt)!,
  }
}

/**
 * GET /api/projects/[projectId]/plans
 * List plans for the project, newest first. `filePath` is intentionally omitted.
 */
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params; const projectId = id
    const ctx = await requireAuth(req)
    await requireProjectMember(projectId, ctx)

    const plans = await db.plan.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { fullName: true } } },
    })

    return Response.json({ plans: plans.map(serializePlan) })
  },
)

/**
 * POST /api/projects/[projectId]/plans (multipart/form-data)
 * Uploads a plan file. Required fields: `file`; optional: `title`, `description`.
 * The plan MIME is validated (validateUpload + matchesMagic) and bytes are
 * persisted to uploads/projects/{projectId}/plans/.
 */
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params; const projectId = id
    const ctx = await requireAuth(req)
    await requireWrite(projectId, ctx)

    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new HttpError(400, 'missing_file', 'A file upload is required (field "file").')
    }
    validateUpload(file, 'plan')

    const bytes = Buffer.from(await file.arrayBuffer())
    if (!matchesMagic(bytes, file.type)) {
      throw new HttpError(
        400,
        'invalid_file_content',
        'File content does not match its declared MIME type.',
      )
    }

    const titleRaw = formData.get('title')
    const descriptionRaw = formData.get('description')

    const title =
      typeof titleRaw === 'string' && titleRaw.trim()
        ? titleRaw.trim().slice(0, 200)
        : file.name.slice(0, 200)
    if (!title) {
      throw new HttpError(400, 'invalid_title', 'A non-empty title (or file name) is required.')
    }

    let description: string | null = null
    if (typeof descriptionRaw === 'string' && descriptionRaw.trim()) {
      description = descriptionRaw.trim().slice(0, 4000)
    }

    const relPath = await writeFileToDisk({
      projectId,
      subdir: 'plans',
      fileName: file.name,
      bytes,
    })

    const plan = await db.plan.create({
      data: {
        projectId,
        title,
        description,
        fileName: file.name,
        filePath: relPath,
        fileSize: bytes.length,
        mimeType: file.type,
        uploadedById: ctx.user.id,
      },
      include: { uploader: { select: { fullName: true } } },
    })

    return Response.json({ plan: serializePlan(plan) }, { status: 201 })
  },
)
