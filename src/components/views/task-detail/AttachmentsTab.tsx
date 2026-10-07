'use client'

import * as React from 'react'
import { File as FileIcon, Trash2, Download, UploadCloud, Loader2, FileText, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { apiPost, apiGet, apiDelete, apiFetchBlob, isQueuedError, ApiError } from '@/lib/client/api'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import type { TaskAttachmentFE, AuthUserFE } from '@/lib/client/types'
import { UserAvatar, formatRelative, formatFileSize } from './shared'

interface Props {
  taskId: string
  canWrite: boolean
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

function isPdf(mime: string): boolean {
  return mime === 'application/pdf'
}

export function AttachmentsTab({ taskId, canWrite }: Props) {
  const showToast = useUiStore((s) => s.showToast)
  const user = useAuthStore((s) => s.user) as AuthUserFE | null
  const [attachments, setAttachments] = React.useState<TaskAttachmentFE[]>([])
  const [loading, setLoading] = React.useState(true)
  const [uploading, setUploading] = React.useState(false)
  const [dragOver, setDragOver] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<{ attachments: TaskAttachmentFE[] }>(`/tasks/${taskId}/attachments`)
      setAttachments(data?.attachments ?? [])
    } catch (e) {
      if (!isQueuedError(e)) showToast({ title: 'Failed to load attachments', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [showToast, taskId])

  React.useEffect(() => { void load() }, [load])

  const uploadFile = async (file: File) => {
    if (!canWrite) return
    setUploading(true)
    const optimistic: TaskAttachmentFE = {
      id: `local-${Date.now()}`,
      taskId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      uploadedById: user?.id ?? 'me',
      uploadedByName: user?.fullName ?? 'You',
      createdAt: new Date().toISOString(),
    }
    setAttachments((cur) => [...cur, optimistic])
    try {
      const created = await apiPost<TaskAttachmentFE>(`/tasks/${taskId}/attachments`, undefined, {
        multipart: { field: 'file', file, fileName: file.name, mimeType: file.type },
      })
      setAttachments((cur) => cur.map((a) => (a.id === optimistic.id ? created : a)))
      showToast({ title: 'Attachment uploaded', variant: 'success' })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', description: 'Attachment will sync when you reconnect.', variant: 'warning' })
      } else {
        setAttachments((cur) => cur.filter((a) => a.id !== optimistic.id))
        const msg = e instanceof ApiError ? e.message : 'Upload failed'
        showToast({ title: 'Upload failed', description: msg, variant: 'error' })
      }
    } finally {
      setUploading(false)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    void Promise.all(files.map(uploadFile))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (!canWrite) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return
    void Promise.all(files.map(uploadFile))
  }

  const handleDelete = async (id: string) => {
    const prev = attachments
    setAttachments((cur) => cur.filter((a) => a.id !== id))
    try {
      await apiDelete(`/attachments/task/${id}`)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setAttachments(prev)
        showToast({ title: 'Delete failed', variant: 'error' })
      }
    }
  }

  if (loading && attachments.length === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 py-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="py-2 space-y-4">
      {canWrite && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragOver ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-300'
          }`}
        >
          <UploadCloud className="h-6 w-6 mx-auto text-zinc-400 mb-2" />
          <p className="text-sm text-zinc-700 font-medium">Drag and drop files here</p>
          <p className="text-xs text-zinc-500 mt-1">or</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            Select files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain"
          />
          <p className="text-[10px] text-zinc-400 mt-2">
            PNG, JPG, WebP, GIF, PDF, TXT · max 50 MB
          </p>
        </div>
      )}

      {attachments.length === 0 ? (
        <div className="text-center py-10 text-sm text-zinc-500">No attachments yet.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.id}
              attachment={a}
              canDelete={canWrite}
              onDelete={() => void handleDelete(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentCard({
  attachment,
  canDelete,
  onDelete,
}: {
  attachment: TaskAttachmentFE
  canDelete: boolean
  onDelete: () => void
}) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null)
  const [loadingBlob, setLoadingBlob] = React.useState(false)

  const fetchBlob = React.useCallback(async () => {
    if (blobUrl) return
    setLoadingBlob(true)
    try {
      const blob = await apiFetchBlob(`/attachments/task/${attachment.id}`)
      setBlobUrl(URL.createObjectURL(blob))
    } catch {
      // ignore — show fallback icon
    } finally {
      setLoadingBlob(false)
    }
  }, [attachment.id, blobUrl])

  React.useEffect(() => {
    if (isImageMime(attachment.mimeType)) {
      void fetchBlob()
    }
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [attachment.mimeType, blobUrl, fetchBlob])

  const download = async () => {
    try {
      const blob = await apiFetchBlob(`/attachments/task/${attachment.id}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = attachment.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      if (!isQueuedError(e)) {
        useUiStore.getState().showToast({ title: 'Download failed', variant: 'error' })
      }
    }
  }

  return (
    <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white flex flex-col">
      <div className="aspect-square bg-zinc-50 flex items-center justify-center overflow-hidden relative">
        {isImageMime(attachment.mimeType) ? (
          blobUrl ? (
            <img src={blobUrl} alt={attachment.fileName} className="w-full h-full object-cover" />
          ) : loadingBlob ? (
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          ) : (
            <ImageIcon className="h-8 w-8 text-zinc-300" />
          )
        ) : isPdf(attachment.mimeType) ? (
          <FileText className="h-8 w-8 text-red-500" />
        ) : (
          <FileIcon className="h-8 w-8 text-zinc-400" />
        )}
      </div>
      <div className="p-2 flex-1 flex flex-col gap-1">
        <p className="text-xs font-medium text-zinc-900 truncate" title={attachment.fileName}>{attachment.fileName}</p>
        <p className="text-[10px] text-zinc-500">{formatFileSize(attachment.fileSize)} · {formatRelative(attachment.createdAt)}</p>
        <div className="flex items-center gap-1 mt-1">
          <UserAvatar name={attachment.uploadedByName} className="h-4 w-4" />
          <span className="text-[10px] text-zinc-500 truncate">{attachment.uploadedByName ?? 'Someone'}</span>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs flex-1" onClick={() => void download()}>
            <Download className="h-3 w-3" />Download
          </Button>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600 hover:text-red-700">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    &ldquo;{attachment.fileName}&rdquo; will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={onDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </div>
  )
}
