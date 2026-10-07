import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  withErrors,
  requireAuth,
  requireProjectMember,
  HttpError,
} from '@/lib/server/permissions'
import { readFileFromDisk } from '@/lib/server/storage'

/**
 * GET /api/plans/[id]/file
 * Streams the stored plan file with appropriate Content-Type and a private
 * cache header. Requires auth + project membership.
 */
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)

    const plan = await db.plan.findUnique({ where: { id } })
    if (!plan) throw new HttpError(404, 'plan_not_found', 'Plan not found.')
    await requireProjectMember(plan.projectId, ctx)

    const bytes = await readFileFromDisk(plan.filePath)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': plan.mimeType,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="${plan.fileName}"`,
      },
    })
  },
)
