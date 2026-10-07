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

interface AttachmentRow {
  id: string
  markupId: string
  fileName: string
  mimeType: string
  fileSize: number
  createdAt: Date
}

function serializeAttachment(a: AttachmentRow) {
  return {
    id: a.id,
    markupId: a.markupId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    url: `/api/attachments/markup/${a.id}`,
    createdAt: toIso(a.createdAt)!,
  }
}

async function getMarkupWithProjectOrFail(id: string) {
  const markup = await db.markup.findUnique({
    where: { id },
    include: { plan: { select: { projectId: true } } },
  })
  if (!markup) throw new HttpError(404, 'markup_not_found', 'Markup not found.')
  return markup
}

/**
 * GET /api/markups/[id]/attachments
 * Lists attachments for a markup. `filePath` and `uploadedById`/`uploadedByName`
 * are intentionally omitted; clients fetch bytes via the returned `url`.
 */
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const markup = await getMarkupWithProjectOrFail(id)
    await requireProjectMember(markup.plan.projectId, ctx)

    const attachments = await db.markupAttachment.findMany({
      where: { markupId: id },
      orderBy: { createdAt: 'asc' },
    })

    return Response.json({ attachments: attachments.map(serializeAttachment) })
  },
)

/**
 * POST /api/markups/[id]/attachments (multipart/form-data)
 * Uploads an attachment for the markup. The file is validated via
 * validateUpload('attachment') and matchesMagic, then persisted under
 * uploads/projects/{projectId}/markup-attachments/.
 */
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const markup = await getMarkupWithProjectOrFail(id)
    await requireWrite(markup.plan.projectId, ctx)

    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new HttpError(400, 'missing_file', 'A file upload is required (field "file").')
    }
    validateUpload(file, 'attachment')

    const bytes = Buffer.from(await file.arrayBuffer())
    if (!matchesMagic(bytes, file.type)) {
      throw new HttpError(
        400,
        'invalid_file_content',
        'File content does not match its declared MIME type.',
      )
    }

    const relPath = await writeFileToDisk({
      projectId: markup.plan.projectId,
      subdir: 'markup-attachments',
      fileName: file.name,
      bytes,
    })

    const attachment = await db.markupAttachment.create({
      data: {
        markupId: id,
        filePath: relPath,
        fileName: file.name,
        mimeType: file.type,
        fileSize: bytes.length,
        uploadedById: ctx.user.id,
      },
    })

    return Response.json({ attachment: serializeAttachment(attachment) }, { status: 201 })
  },
)
