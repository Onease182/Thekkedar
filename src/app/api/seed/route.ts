import type { NextRequest } from 'next/server'
import type { Task } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, withErrors } from '@/lib/server/permissions'
import { hashPassword } from '@/lib/server/auth'
import { writeFileToDisk } from '@/lib/server/storage'

const DEMO_EMAIL = 'demo@planforge.app'
const FOREMAN_EMAIL = 'foreman@planforge.app'
const PROJECT_CODE = 'SKY-001'
const DEFAULT_PASSWORD = 'password123'

// 1x1 transparent PNG bytes (hand-crafted minimal PNG).
const SAMPLE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

/**
 * Builds a minimal but valid single-page PDF that renders "{title}" at the top
 * and "{body}" below it. The byte template is hand-fixed; placeholders are
 * string-substituted with proper PDF string escaping.
 */
function minimalPdf(title: string, body: string): Buffer {
  const tmpl = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 80 >>
stream
BT /F1 24 Tf 72 700 Td (TITLE_PLACEHOLDER) Tj 0 -36 Td /F1 12 Tf (BODY_PLACEHOLDER) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000400 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
467
%%EOF`
  const esc = (s: string) => s.replace(/([\\()])/g, '\\$1').slice(0, 80)
  return Buffer.from(
    tmpl.replace('TITLE_PLACEHOLDER', esc(title)).replace('BODY_PLACEHOLDER', esc(body)),
    'latin1',
  )
}

/**
 * POST /api/seed
 * Idempotently builds a demo dataset (project, users, plans, markups, tasks,
 * comments, checklist, watchers). Any authenticated user may trigger it; if
 * the demo project already exists, returns early with its IDs.
 */
export const POST = withErrors(async (req: NextRequest) => {
  const ctx = await requireAuth(req)

  // Idempotency: if the demo project already exists, return early.
  const existing = await db.project.findUnique({ where: { code: PROJECT_CODE } })
  if (existing) {
    const demoUser = await db.user.findUnique({ where: { email: DEMO_EMAIL } })
    const foremanUser = await db.user.findUnique({ where: { email: FOREMAN_EMAIL } })
    return Response.json({
      ok: true,
      seeded: false,
      projectId: existing.id,
      demoUserId: demoUser?.id ?? null,
      foremanUserId: foremanUser?.id ?? null,
    })
  }

  // 1. Create demo user (if missing).
  let demoUser = await db.user.findUnique({ where: { email: DEMO_EMAIL } })
  if (!demoUser) {
    demoUser = await db.user.create({
      data: {
        email: DEMO_EMAIL,
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        fullName: 'Demo Engineer',
        role: 'engineer',
      },
    })
  }
  const demoUserId = demoUser.id

  // 2. Create foreman user (if missing).
  let foremanUser = await db.user.findUnique({ where: { email: FOREMAN_EMAIL } })
  if (!foremanUser) {
    foremanUser = await db.user.create({
      data: {
        email: FOREMAN_EMAIL,
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        fullName: 'Pat Foreman',
        role: 'foreman',
      },
    })
  }
  const foremanUserId = foremanUser.id

  // 3. Create the demo project.
  const project = await db.project.create({
    data: {
      name: 'Skyline Tower',
      code: PROJECT_CODE,
      description:
        'A 24-story mixed-use residential tower with 3 levels of underground parking. This demo project showcases plans, markups, tasks, comments, and checklists.',
      ownerId: demoUserId,
    },
  })
  const projectId = project.id

  // 4. Project members: demo (PM), foreman, current user (engineer).
  await db.projectMember.create({
    data: { projectId, userId: demoUserId, role: 'project_manager' },
  })
  await db.projectMember.create({
    data: { projectId, userId: foremanUserId, role: 'foreman' },
  })
  const existingMember = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: ctx.user.id } },
  })
  if (!existingMember && ctx.user.id !== demoUserId) {
    await db.projectMember.create({
      data: { projectId, userId: ctx.user.id, role: 'engineer' },
    })
  }

  // 5. Create 2 plans on disk + DB rows.
  const plan1Pdf = minimalPdf(
    'Architectural - Level 3 Floor Plan',
    'Level 3 - residential floor plan, units 301-312. Scale: 1/8" = 1\'-0".',
  )
  const plan1Path = await writeFileToDisk({
    projectId,
    subdir: 'plans',
    fileName: 'arch-level3.pdf',
    bytes: plan1Pdf,
  })
  const plan1 = await db.plan.create({
    data: {
      projectId,
      title: 'Architectural - Level 3 Floor Plan',
      description: 'Level 3 residential floor plan with units 301-312 and common corridor.',
      fileName: 'arch-level3.pdf',
      filePath: plan1Path,
      fileSize: plan1Pdf.length,
      mimeType: 'application/pdf',
      uploadedById: demoUserId,
    },
  })

  const plan2Pdf = minimalPdf(
    'Structural - Foundation',
    "Foundation plan - 24\" thick concrete mat slab on caissons. F'c = 5000 psi.",
  )
  const plan2Path = await writeFileToDisk({
    projectId,
    subdir: 'plans',
    fileName: 'struct-foundation.pdf',
    bytes: plan2Pdf,
  })
  const plan2 = await db.plan.create({
    data: {
      projectId,
      title: 'Structural - Foundation',
      description: 'Foundation plan - mat slab on caissons.',
      fileName: 'struct-foundation.pdf',
      filePath: plan2Path,
      fileSize: plan2Pdf.length,
      mimeType: 'application/pdf',
      uploadedById: demoUserId,
    },
  })

  // 6. Create markups: pin, rectangle, text note.
  const markup1 = await db.markup.create({
    data: {
      planId: plan1.id,
      type: 'pin',
      pageNumber: 1,
      coordinates: JSON.stringify({ x: 0.42, y: 0.3 }),
      color: '#ef4444',
      metadata: JSON.stringify({ label: 'Unit 301 - verify dimensions' }),
      createdById: demoUserId,
    },
  })
  const markup2 = await db.markup.create({
    data: {
      planId: plan1.id,
      type: 'rectangle',
      pageNumber: 1,
      coordinates: JSON.stringify({ x: 0.55, y: 0.55, w: 0.18, h: 0.12 }),
      color: '#f59e0b',
      metadata: JSON.stringify({ label: 'Corridor area' }),
      createdById: demoUserId,
    },
  })
  const markup3 = await db.markup.create({
    data: {
      planId: plan2.id,
      type: 'text',
      pageNumber: 1,
      coordinates: JSON.stringify({ x: 0.3, y: 0.7, text: 'Reinforcement detail TBD' }),
      color: '#3b82f6',
      metadata: JSON.stringify({}),
      createdById: demoUserId,
    },
  })

  // 7. Add a small PNG attachment on markup1.
  const pngPath = await writeFileToDisk({
    projectId,
    subdir: 'markup-attachments',
    fileName: 'sample.png',
    bytes: SAMPLE_PNG_BYTES,
  })
  await db.markupAttachment.create({
    data: {
      markupId: markup1.id,
      filePath: pngPath,
      fileName: 'sample.png',
      mimeType: 'image/png',
      fileSize: SAMPLE_PNG_BYTES.length,
      uploadedById: demoUserId,
    },
  })

  // 8. Create 5 tasks spread across statuses/priorities.
  const now = new Date()
  const inDays = (n: number) => new Date(now.getTime() + n * 86400000)
  const tasksData = [
    {
      title: 'Verify Unit 301 bedroom dimensions on plan',
      description:
        'Cross-check the bedroom dimensions in Unit 301 against the latest architectural drawings. Markup 1 pins the location.',
      planId: plan1.id,
      markupId: markup1.id,
      pageNumber: 1,
      pinCoordinates: JSON.stringify({ x: 0.42, y: 0.3 }),
      assigneeId: foremanUserId,
      trade: 'architectural',
      category: 'verification',
      locationName: 'Level 3 - Unit 301',
      priority: 'P1',
      status: 'open',
      dueDate: inDays(3),
      startDate: now,
      tags: JSON.stringify(['verification', 'unit-301']),
      estimatedHours: 2,
    },
    {
      title: 'Install reinforcement at mat slab perimeter - west side',
      description: 'Coordinate with the rebar sub for the west perimeter detail. Tie #8 bars @ 12" O.C. each way.',
      planId: plan2.id,
      markupId: null,
      pageNumber: 1,
      pinCoordinates: null,
      assigneeId: foremanUserId,
      trade: 'concrete',
      category: 'reinforcement',
      locationName: 'Foundation - West',
      priority: 'P2',
      status: 'in_progress',
      dueDate: inDays(7),
      startDate: now,
      tags: JSON.stringify(['structural', 'rebar']),
      estimatedHours: 16,
    },
    {
      title: 'Submit RFI: corridor header height clearance',
      description:
        'Architectural plan shows 8\'-0" ceiling; structural shows a 12" drop beam. Need to clarify clearance for corridor.',
      planId: plan1.id,
      markupId: markup2.id,
      pageNumber: 1,
      pinCoordinates: JSON.stringify({ x: 0.6, y: 0.58 }),
      assigneeId: foremanUserId,
      trade: 'architectural',
      category: 'rfi',
      locationName: 'Level 3 - Corridor',
      priority: 'P1',
      status: 'blocked',
      dueDate: inDays(1),
      startDate: now,
      tags: JSON.stringify(['rfi', 'corridor']),
      estimatedHours: 1,
    },
    {
      title: 'Foundation caisson layout check - surveyor sign-off',
      description: 'Surveyor to verify caisson layout against plan. Tolerance +/- 1/2".',
      planId: plan2.id,
      markupId: markup3.id,
      pageNumber: 1,
      pinCoordinates: JSON.stringify({ x: 0.3, y: 0.7 }),
      assigneeId: foremanUserId,
      trade: 'surveying',
      category: 'layout',
      locationName: 'Foundation - All',
      priority: 'P3',
      status: 'done',
      dueDate: inDays(-2),
      startDate: inDays(-5),
      tags: JSON.stringify(['survey', 'caisson']),
      estimatedHours: 4,
    },
    {
      title: 'Pre-pour walkthrough checklist',
      description:
        'Conduct pre-pour walkthrough with GC, structural engineer, and inspector. Sign off form before concrete trucks arrive.',
      planId: plan2.id,
      markupId: null,
      pageNumber: 1,
      pinCoordinates: null,
      assigneeId: foremanUserId,
      trade: 'concrete',
      category: 'qaqc',
      locationName: 'Foundation - All',
      priority: 'P2',
      status: 'open',
      dueDate: inDays(5),
      startDate: now,
      tags: JSON.stringify(['qaqc', 'pre-pour']),
      estimatedHours: 2,
    },
  ]
  const createdTasks: Task[] = []
  for (const t of tasksData) {
    const task = await db.task.create({
      data: {
        projectId,
        planId: t.planId,
        markupId: t.markupId,
        pageNumber: t.pageNumber,
        pinCoordinates: t.pinCoordinates,
        title: t.title,
        description: t.description,
        assigneeId: t.assigneeId,
        trade: t.trade,
        category: t.category,
        locationName: t.locationName,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate,
        startDate: t.startDate,
        tags: t.tags,
        estimatedHours: t.estimatedHours,
        createdById: demoUserId,
      },
    })
    createdTasks.push(task)
  }

  // 9. Create 3 comments on the first task (the verification task).
  const t0 = createdTasks[0]
  await db.taskComment.create({
    data: {
      taskId: t0.id,
      authorId: demoUserId,
      body: 'Flagging this for review - the bedroom is showing 11\'-2" but the program calls for 12\'-0".',
    },
  })
  await db.taskComment.create({
    data: {
      taskId: t0.id,
      authorId: foremanUserId,
      body: 'On it - measuring on site this afternoon. Will update by EOD.',
    },
  })
  await db.taskComment.create({
    data: {
      taskId: t0.id,
      authorId: demoUserId,
      body: 'Thanks. Pinging the architect for confirmation too.',
    },
  })

  // 10. Create 1 checklist with 3 items on the pre-pour walkthrough task.
  const t4 = createdTasks[4]
  const checklist = await db.taskChecklist.create({
    data: {
      taskId: t4.id,
      title: 'Pre-pour walkthrough items',
      order: 0,
    },
  })
  const checklistItems = [
    { text: 'Verify rebar size, spacing, and cover at all locations', isChecked: false, order: 0 },
    { text: 'Confirm embeds (mechanical, electrical) are in place', isChecked: false, order: 1 },
    { text: 'Inspector sign-off received and on file', isChecked: false, order: 2 },
  ]
  for (const item of checklistItems) {
    await db.taskChecklistItem.create({
      data: {
        checklistId: checklist.id,
        text: item.text,
        isChecked: item.isChecked,
        order: item.order,
      },
    })
  }

  // 11. Add the current user as a watcher on a couple of tasks.
  await db.taskWatcher.upsert({
    where: { taskId_userId: { taskId: createdTasks[0].id, userId: ctx.user.id } },
    create: { taskId: createdTasks[0].id, userId: ctx.user.id },
    update: {},
  })
  await db.taskWatcher.upsert({
    where: { taskId_userId: { taskId: createdTasks[2].id, userId: ctx.user.id } },
    create: { taskId: createdTasks[2].id, userId: ctx.user.id },
    update: {},
  })
  // Foreman is watcher on the verification task.
  await db.taskWatcher.upsert({
    where: { taskId_userId: { taskId: createdTasks[0].id, userId: foremanUserId } },
    create: { taskId: createdTasks[0].id, userId: foremanUserId },
    update: {},
  })

  return Response.json(
    {
      ok: true,
      seeded: true,
      projectId,
      demoUserId,
      foremanUserId,
    },
    { status: 201 },
  )
})
