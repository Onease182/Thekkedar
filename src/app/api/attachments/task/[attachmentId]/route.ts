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
import { readFileFromDisk, deleteFileFromDisk } from '@/lib/server/storage'
import type { Role } from '@/types'

export const dynamic = 'force-dynamic'

async function loadAttachmentForCtx(attachmentId: string, ctx: AuthContext): Promise<{ attachment: any; role: Role }> {
  const attachment = await db.taskAttachment.findUnique({
    where: { id: attachmentId },
    include: { task: { include: { project: true } } },
  })
  if (!attachment) throw new HttpError(404, 'attachment_not_found', 'Attachment not found.')
  const { role } = await requireProjectMember(attachment.task.projectId, ctx)
  return { attachment, role }
}

// GET /api/attachments/task/[attachmentId] — stream file bytes inline.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) => {
    const { attachmentId } = await params
    const ctx = await requireAuth(req)
    const { attachment } = await loadAttachmentForCtx(attachmentId, ctx)

    const bytes = await readFileFromDisk(attachment.filePath)
    const encodedName = encodeURIComponent(attachment.fileName)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  },
)

// DELETE /api/attachments/task/[attachmentId] — delete row + file on disk.
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) => {
    const { attachmentId } = await params
    const ctx = await requireAuth(req)
    const { attachment, role } = await loadAttachmentForCtx(attachmentId, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    await db.taskAttachment.delete({ where: { id: attachmentId } })
    await deleteFileFromDisk(attachment.filePath)
    return Response.json({ ok: true })
  },
)
