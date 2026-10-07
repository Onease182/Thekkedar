import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  withErrors,
  requireAuth,
  requireProjectMember,
  requireWrite,
  HttpError,
} from '@/lib/server/permissions'
import { readFileFromDisk, deleteFileFromDisk } from '@/lib/server/storage'

async function getAttachmentWithProjectOrFail(id: string) {
  const attachment = await db.markupAttachment.findUnique({
    where: { id },
    include: {
      markup: {
        select: {
          plan: { select: { projectId: true } },
        },
      },
    },
  })
  if (!attachment) throw new HttpError(404, 'attachment_not_found', 'Attachment not found.')
  return attachment
}

/**
 * GET /api/attachments/markup/[attachmentId]
 * Streams the attachment file with a private cache header.
 */
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) => {
    const { attachmentId } = await params
    const ctx = await requireAuth(req)
    const attachment = await getAttachmentWithProjectOrFail(attachmentId)
    const projectId = attachment.markup?.plan?.projectId
    if (!projectId) {
      throw new HttpError(404, 'project_not_found', 'Attachment has no associated project.')
    }
    await requireProjectMember(projectId, ctx)

    const bytes = await readFileFromDisk(attachment.filePath)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="${attachment.fileName}"`,
      },
    })
  },
)

/**
 * DELETE /api/attachments/markup/[attachmentId]
 * Removes the attachment row and best-effort deletes the underlying file.
 */
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) => {
    const { attachmentId } = await params
    const ctx = await requireAuth(req)
    const attachment = await getAttachmentWithProjectOrFail(attachmentId)
    const projectId = attachment.markup?.plan?.projectId
    if (!projectId) {
      throw new HttpError(404, 'project_not_found', 'Attachment has no associated project.')
    }
    await requireWrite(projectId, ctx)

    const filePath = attachment.filePath
    await db.markupAttachment.delete({ where: { id: attachmentId } })
    await deleteFileFromDisk(filePath)

    return Response.json({ ok: true })
  },
)
