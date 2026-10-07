import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  requireProjectMember,
  withErrors,
  HttpError,
  type AuthContext,
} from '@/lib/server/permissions'
import { canWrite } from '@/lib/server/constants'
import { validateUpload, writeFileToDisk, matchesMagic } from '@/lib/server/storage'
import type { Role } from '@/types'

export const dynamic = 'force-dynamic'

async function loadTaskForCtx(id: string, ctx: AuthContext): Promise<{ task: any; role: Role }> {
  const task = await db.task.findUnique({
    where: { id },
    include: { project: true },
  })
  if (!task || task.deletedAt) throw new HttpError(404, 'task_not_found', 'Task not found.')
  const { role } = await requireProjectMember(task.projectId, ctx)
  return { task, role }
}

function mapAttachment(a: any) {
  return {
    id: a.id,
    taskId: a.taskId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    uploadedById: a.uploadedById,
    uploadedByName: a.uploadedBy?.fullName ?? null,
    createdAt: a.createdAt.toISOString(),
  }
}

// GET /api/tasks/[id]/attachments — list attachments (filePath omitted).
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    await loadTaskForCtx(id, ctx)

    const attachments = await db.taskAttachment.findMany({
      where: { taskId: id },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    })

    return Response.json({ attachments: attachments.map(mapAttachment) })
  },
)

// POST /api/tasks/[id]/attachments — multipart upload. Validates the file
// against the attachment allow-list, magic-byte checks the content, then
// writes to disk under projects/{projectId}/task-attachments/.
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { task, role } = await loadTaskForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      throw new HttpError(400, 'missing_file', 'No file uploaded.')
    }

    validateUpload(file, 'attachment')

    const bytes = Buffer.from(await file.arrayBuffer())
    if (!matchesMagic(bytes, file.type)) {
      throw new HttpError(400, 'invalid_file', 'File content does not match its declared type.')
    }

    const filePath = await writeFileToDisk({
      projectId: task.projectId,
      subdir: 'task-attachments',
      fileName: file.name,
      bytes,
    })

    const attachment = await db.taskAttachment.create({
      data: {
        taskId: id,
        filePath,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        uploadedById: ctx.user.id,
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    })

    return NextResponse.json(mapAttachment(attachment), { status: 201 })
  },
)
