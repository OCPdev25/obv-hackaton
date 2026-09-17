import { describe, expect, it } from 'vitest'
import { decodeEvent, type EntryWire } from '../src/contract/schema'
import { buildEntryPayload, storePhotoCapture, type PhotoCaptureCommit, type PhotoStorageTransport } from '../src/photo/photoStorage'
import { PhotoCaptureError, type PickedPhoto } from '../src/photo/types'

function photo(): PickedPhoto {
  return { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/jpeg', sizeBytes: 4 }
}

const mealEventWire: EntryWire['events'][number] = {
  _tag: 'Event',
  category: 'meal',
  occurredAt: 1726500000000,
  confidence: 0.9,
  authorId: 'caregiver_1',
}

/** Domain-shape event for flow inputs: built through the contract's decode entry point. */
const mealEvent = decodeEvent(mealEventWire)

function fakeTransport(overrides: Partial<PhotoStorageTransport> = {}): PhotoStorageTransport & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    requestUploadUrl: async () => {
      calls.push('url')
      return 'https://convex.example/upload'
    },
    uploadPhoto: async (uploadUrl, picked) => {
      calls.push(`upload:${uploadUrl}:${picked.mimeType}:${picked.sizeBytes}`)
      return { storageId: 'st_123' }
    },
    commitPhoto: async (commit: PhotoCaptureCommit) => {
      calls.push(`commit:${commit.storageId}:${commit.entry === undefined ? 'no-entry' : 'entry'}`)
      return { entryId: 'entry_1' }
    },
    ...overrides,
  }
}

describe('storePhotoCapture', () => {
  it('runs the 3-request Convex flow in order: upload URL, POST, commit', async () => {
    const transport = fakeTransport()
    const result = await storePhotoCapture(transport, {
      photo: photo(),
      authorId: 'caregiver_1',
      transcript: 'First day of school',
    })
    expect(transport.calls).toEqual([
      'url',
      'upload:https://convex.example/upload:image/jpeg:4',
      'commit:st_123:entry',
    ])
    expect(result).toEqual({ storageId: 'st_123', entryId: 'entry_1', transcript: 'First day of school' })
  })

  it('commits the Entry in wire form (unix-ms createdAt, _tag present, events array)', async () => {
    const commits: PhotoCaptureCommit[] = []
    const transport = fakeTransport({
      commitPhoto: async (commit) => {
        commits.push(commit)
        return { entryId: 'entry_1' }
      },
    })
    await storePhotoCapture(transport, {
      photo: photo(),
      authorId: 'caregiver_1',
      status: 'published',
      transcript: '  First day  ',
      events: [mealEvent],
    })
    expect(commits).toHaveLength(1)
    const entry = commits[0]?.entry
    expect(entry?._tag).toBe('Entry')
    expect(entry?.createdAt).toBeTypeOf('number')
    expect(entry?.transcript).toBe('First day')
    expect(entry?.status).toBe('published')
    expect(entry?.events[0]?.occurredAt).toBe(1726500000000)
  })

  it('supports photo-only capture: no Entry, commit called without one', async () => {
    const transport = fakeTransport()
    const result = await storePhotoCapture(transport, { photo: photo(), authorId: 'caregiver_1' })
    expect(transport.calls).toEqual(['url', 'upload:https://convex.example/upload:image/jpeg:4', 'commit:st_123:no-entry'])
    expect(result.entryId).toBe('entry_1')
    expect(result.transcript).toBeNull()
  })

  it('rejects a whitespace-only transcript before any network call', async () => {
    const transport = fakeTransport()
    await expect(
      storePhotoCapture(transport, { photo: photo(), authorId: 'caregiver_1', transcript: '   ' }),
    ).rejects.toMatchObject({ code: 'empty-transcript', name: 'PhotoCaptureError' })
    expect(transport.calls).toEqual([])
  })

  it('wraps upload-URL failures as upload-failed with cause', async () => {
    const transport = fakeTransport({ requestUploadUrl: () => Promise.reject(new Error('not signed in')) })
    await expect(
      storePhotoCapture(transport, { photo: photo(), authorId: 'caregiver_1' }),
    ).rejects.toMatchObject({ code: 'upload-failed' })
  })

  it('wraps upload failures as upload-failed with cause', async () => {
    const transport = fakeTransport({ uploadPhoto: () => Promise.reject(new Error('413 too large')) })
    await expect(
      storePhotoCapture(transport, { photo: photo(), authorId: 'caregiver_1' }),
    ).rejects.toMatchObject({ code: 'upload-failed' })
  })

  it('wraps commit failures as commit-failed — the bytes are stored, the record is not lost silently', async () => {
    const transport = fakeTransport({ commitPhoto: () => Promise.reject(new Error('write conflict')) })
    await expect(
      storePhotoCapture(transport, { photo: photo(), authorId: 'caregiver_1' }),
    ).rejects.toMatchObject({ code: 'commit-failed' })
  })
})

describe('buildEntryPayload', () => {
  it('returns null when no transcript is given (photo-only capture)', () => {
    expect(buildEntryPayload({ authorId: 'caregiver_1' })).toBeNull()
  })

  it('trims and defaults to draft status with empty events', () => {
    const entry = buildEntryPayload({ authorId: 'caregiver_1', transcript: '  hi  ' })
    expect(entry?.transcript).toBe('hi')
    expect(entry?.status).toBe('draft')
    expect(entry?.events).toEqual([])
    expect(entry?.createdAt).toBeInstanceOf(Date)
  })

  it('honors an explicit capturedAt for deterministic tests', () => {
    const capturedAt = new Date(1726500000000)
    const entry = buildEntryPayload({ authorId: 'caregiver_1', transcript: 'hi', capturedAt })
    expect(entry?.createdAt.getTime()).toBe(1726500000000)
  })
})
