import CryptoKit
import Foundation

final class CaptureDraftStore {
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func ownerHash(_ ownerUid: String) throws -> String {
        let clean = ownerUid.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { throw CaptureError.ownerRequired }
        return SHA256.hash(data: Data(clean.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func directory(for ownerUid: String) throws -> URL {
        try directory(forHash: try ownerHash(ownerUid))
    }

    /// Locate a draft directory from an already-computed owner hash. Used by
    /// callers (e.g. updateStatus) that hold the hash rather than the raw uid.
    func directory(forHash ownerHash: String) throws -> URL {
        let base = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("CaptureDrafts", isDirectory: true)
            .appendingPathComponent(ownerHash, isDirectory: true)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    func audioURL(ownerUid: String, draftId: String) throws -> URL {
        let id = try validatedDraftId(draftId)
        return try directory(for: ownerUid).appendingPathComponent("\(id).m4a")
    }

    func save(_ draft: CaptureDraft, ownerUid: String) throws {
        let url = try directory(for: ownerUid).appendingPathComponent("\(draft.id).json")
        let data = try encoder.encode(draft)
        try data.write(to: url, options: .atomic)
    }

    func drafts(ownerUid: String) throws -> [CaptureDraft] {
        let directory = try directory(for: ownerUid)
        return try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(CaptureDraft.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func draft(ownerUid: String, draftId: String) throws -> CaptureDraft {
        let id = try validatedDraftId(draftId)
        let url = try directory(for: ownerUid).appendingPathComponent("\(id).json")
        return try decoder.decode(CaptureDraft.self, from: Data(contentsOf: url))
    }

    /// Update only the status field of an existing draft's sidecar JSON, keyed
    /// by an already-computed owner hash. Reads the sidecar, mutates status, and
    /// rewrites atomically. Verifies the decoded draft's ownerHash matches the
    /// caller-supplied hash (defence in depth — the directory is already
    /// hash-scoped) before writing.
    func updateStatus(id: String, ownerHash: String, status: CaptureDraft.Status) throws {
        let draftId = try validatedDraftId(id)
        let url = try directory(forHash: ownerHash).appendingPathComponent("\(draftId).json")
        var draft = try decoder.decode(CaptureDraft.self, from: Data(contentsOf: url))
        guard draft.ownerHash == ownerHash else { throw CaptureError.ownerMismatch }
        draft.status = status
        let data = try encoder.encode(draft)
        try data.write(to: url, options: .atomic)
    }

    /// Append a chapter-mark marker to an existing draft's sidecar JSON,
    /// keyed by an already-computed owner hash — mirrors updateStatus above
    /// exactly (read, mutate one field, atomic rewrite), so a chapter tap is
    /// durable on disk before the caller (CaptureCoordinator.markChapter)
    /// returns, the same way a status transition is.
    func addMarker(id: String, ownerHash: String, tMs: Int) throws {
        let draftId = try validatedDraftId(id)
        let url = try directory(forHash: ownerHash).appendingPathComponent("\(draftId).json")
        var draft = try decoder.decode(CaptureDraft.self, from: Data(contentsOf: url))
        guard draft.ownerHash == ownerHash else { throw CaptureError.ownerMismatch }
        draft.markers = (draft.markers ?? []) + [Marker(tMs: tMs)]
        let data = try encoder.encode(draft)
        try data.write(to: url, options: .atomic)
    }

    func delete(ownerUid: String, draftId: String) throws {
        let id = try validatedDraftId(draftId)
        let directory = try directory(for: ownerUid)
        for url in [directory.appendingPathComponent("\(id).json"), directory.appendingPathComponent("\(id).m4a")] {
            if fileManager.fileExists(atPath: url.path) { try fileManager.removeItem(at: url) }
        }
    }

    private func validatedDraftId(_ draftId: String) throws -> String {
        guard let uuid = UUID(uuidString: draftId) else { throw CaptureError.invalidDraftId }
        return uuid.uuidString.lowercased()
    }
}

enum CaptureError: LocalizedError {
    case ownerRequired
    case permissionDenied
    case alreadyRecording
    case noActiveRecording
    case ownerMismatch
    case invalidDraftId
    case recorderFailed
    case writeFailed

    var errorDescription: String? {
        switch self {
        case .ownerRequired: return "owner_required"
        case .permissionDenied: return "microphone_permission_denied"
        case .alreadyRecording: return "capture_already_recording"
        case .noActiveRecording: return "capture_not_recording"
        case .ownerMismatch: return "capture_owner_mismatch"
        case .invalidDraftId: return "capture_invalid_draft_id"
        case .recorderFailed: return "capture_recorder_failed"
        case .writeFailed: return "capture_write_failed"
        }
    }
}
