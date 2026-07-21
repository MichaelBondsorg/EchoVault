import AVFoundation
import Foundation

final class CaptureCoordinator: NSObject, AVAudioRecorderDelegate {
    static let shared = CaptureCoordinator()

    private let session = AVAudioSession.sharedInstance()
    private let store = CaptureDraftStore()
    private var recorder: AVAudioRecorder?
    private var activeDraft: CaptureDraft?
    private var activeOwnerUid: String?

    private override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption),
            name: AVAudioSession.interruptionNotification,
            object: session
        )
    }

    func requestPermission(completion: @escaping (Bool) -> Void) {
        switch session.recordPermission {
        case .granted: completion(true)
        case .denied: completion(false)
        case .undetermined: session.requestRecordPermission(completion)
        @unknown default: completion(false)
        }
    }

    func start(ownerUid: String) throws -> CaptureDraft {
        guard recorder == nil else { throw CaptureError.alreadyRecording }
        guard session.recordPermission == .granted else { throw CaptureError.permissionDenied }

        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let id = UUID().uuidString.lowercased()
        let url = try store.audioURL(ownerUid: ownerUid, draftId: id)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let draft = CaptureDraft(
            id: id,
            ownerHash: try store.ownerHash(ownerUid),
            fileName: url.lastPathComponent,
            mime: "audio/mp4",
            createdAt: Date(),
            durationMilliseconds: 0,
            status: .recording
        )
        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.delegate = self
            recorder.isMeteringEnabled = true
            try store.save(draft, ownerUid: ownerUid)
            guard recorder.record() else { throw CaptureError.recorderFailed }
            self.recorder = recorder
            activeDraft = draft
            activeOwnerUid = ownerUid
            return draft
        } catch {
            try? store.delete(ownerUid: ownerUid, draftId: id)
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
    }

    func stop(ownerUid: String, draftId: String) throws -> (CaptureDraft, Data) {
        guard let recorder, var draft = activeDraft else { throw CaptureError.noActiveRecording }
        guard activeOwnerUid == ownerUid, draft.id == draftId else { throw CaptureError.ownerMismatch }
        defer { try? session.setActive(false, options: .notifyOthersOnDeactivation) }

        let duration = recorder.currentTime
        recorder.stop()
        self.recorder = nil
        activeDraft = nil
        activeOwnerUid = nil

        draft.durationMilliseconds = Int(duration * 1_000)
        draft.status = .stored
        try store.save(draft, ownerUid: ownerUid)
        let data = try Data(contentsOf: try store.audioURL(ownerUid: ownerUid, draftId: draft.id))
        guard !data.isEmpty else { throw CaptureError.writeFailed }
        return (draft, data)
    }

    /// Voice Chapters (flag: voiceChapters) — mark a chapter at the current
    /// recording position. `recorder.currentTime` is the audio clock (not
    /// JS Date.now(), which would drift relative to the actual recorded
    /// audio), matching how `stop()` derives durationMilliseconds above.
    /// The sidecar write (store.addMarker) is atomic and happens before this
    /// returns, so the marker is durable even if the app is immediately
    /// backgrounded/interrupted afterward.
    func markChapter(ownerUid: String, draftId: String) throws -> Int {
        guard let recorder, let draft = activeDraft else { throw CaptureError.noActiveRecording }
        guard activeOwnerUid == ownerUid, draft.id == draftId else { throw CaptureError.ownerMismatch }
        let tMs = Int(recorder.currentTime * 1_000)
        try store.addMarker(id: draftId, ownerHash: draft.ownerHash, tMs: tMs)
        return tMs
    }

    func drafts(ownerUid: String) throws -> [CaptureDraft] { try store.drafts(ownerUid: ownerUid) }

    func read(ownerUid: String, draftId: String) throws -> (CaptureDraft, Data) {
        let draft = try store.draft(ownerUid: ownerUid, draftId: draftId)
        guard draft.ownerHash == (try store.ownerHash(ownerUid)) else { throw CaptureError.ownerMismatch }
        return (draft, try Data(contentsOf: store.audioURL(ownerUid: ownerUid, draftId: draftId)))
    }

    func delete(ownerUid: String, draftId: String) throws {
        if activeDraft?.id == draftId { throw CaptureError.alreadyRecording }
        try store.delete(ownerUid: ownerUid, draftId: draftId)
    }

    /// Update a stored draft's status (e.g. mark uploaded/needsReview from JS).
    func updateStatus(ownerUid: String, draftId: String, status: CaptureDraft.Status) throws {
        try store.updateStatus(id: draftId, ownerHash: try store.ownerHash(ownerUid), status: status)
    }

    /// Resolve the on-disk audio file URL for a draft (used by the background
    /// uploader and duration derivation).
    func audioURL(ownerUid: String, draftId: String) throws -> URL {
        try store.audioURL(ownerUid: ownerUid, draftId: draftId)
    }

    /// Owner hash for a uid (used when tagging background upload tasks).
    func ownerHash(_ ownerUid: String) throws -> String {
        try store.ownerHash(ownerUid)
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let recorder, var draft = activeDraft, let ownerUid = activeOwnerUid else { return }
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        draft.durationMilliseconds = Int(recorder.currentTime * 1_000)
        recorder.stop()
        draft.status = .needsReview
        try? store.save(draft, ownerUid: ownerUid)
        self.recorder = nil
        activeDraft = nil
        activeOwnerUid = nil
    }
}
