import AVFoundation
import Capacitor
import Foundation

@objc(CapturePlugin)
public final class CapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapturePlugin"
    public let jsName = "Capture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDrafts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readDraft", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteDraft", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateDraftStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enqueueUpload", returnType: CAPPluginReturnPromise),
    ]

    // Mutation of the listDrafts result buffer is funnelled through this serial
    // queue so concurrent AVAsset duration completions never race.
    private let durationSyncQueue = DispatchQueue(label: "com.echovault.engram.capture.duration")

    public override func load() {
        // Forward background-upload results (posted by BackgroundUploader) to JS.
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleUploadProgress(_:)),
            name: BackgroundUploader.progressNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleUploadComplete(_:)),
            name: BackgroundUploader.completeNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleUploadFailed(_:)),
            name: BackgroundUploader.failedNotification, object: nil
        )
        // Ensure the background session/delegate is alive to receive events.
        BackgroundUploader.shared.activate()
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        CaptureCoordinator.shared.requestPermission { granted in
            DispatchQueue.main.async { call.resolve(["granted": granted]) }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), !ownerUid.isEmpty else {
            call.reject("owner_required")
            return
        }
        do {
            let draft = try CaptureCoordinator.shared.start(ownerUid: ownerUid)
            call.resolve([
                "draftId": draft.id,
                "startedAt": ISO8601DateFormatter().string(from: draft.createdAt),
            ])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), let draftId = call.getString("draftId") else {
            call.reject("capture_arguments_required")
            return
        }
        do {
            let (draft, data) = try CaptureCoordinator.shared.stop(ownerUid: ownerUid, draftId: draftId)
            call.resolve([
                "draftId": draft.id,
                "assetId": draft.id,
                "mime": draft.mime,
                "durationMs": draft.durationMilliseconds,
                "base64": data.base64EncodedString(),
            ])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func listDrafts(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid") else {
            call.reject("owner_required")
            return
        }
        let drafts: [CaptureDraft]
        do {
            drafts = try CaptureCoordinator.shared.drafts(ownerUid: ownerUid)
        } catch {
            call.reject(error.localizedDescription)
            return
        }

        let iso = ISO8601DateFormatter()
        let group = DispatchGroup()
        var results = [[String: Any]?](repeating: nil, count: drafts.count)

        for (index, draft) in drafts.enumerated() {
            group.enter()
            var base: [String: Any] = [
                "draftId": draft.id,
                "createdAt": iso.string(from: draft.createdAt),
                "durationMs": draft.durationMilliseconds,
                "status": draft.status.rawValue,
            ]
            // `durationMilliseconds` (additive) is the derived value; `durationMs`
            // stays the raw sidecar value for backward compatibility.
            let finish: (Int) -> Void = { [durationSyncQueue] ms in
                base["durationMilliseconds"] = ms
                durationSyncQueue.async {
                    results[index] = base
                    group.leave()
                }
            }

            if draft.durationMilliseconds > 0 {
                finish(draft.durationMilliseconds)
            } else if let url = try? CaptureCoordinator.shared.audioURL(ownerUid: ownerUid, draftId: draft.id) {
                loadDurationMilliseconds(url: url) { ms in finish(ms) }
            } else {
                finish(0)
            }
        }

        group.notify(queue: .main) { [durationSyncQueue] in
            durationSyncQueue.async {
                let ordered = results.compactMap { $0 }
                DispatchQueue.main.async { call.resolve(["drafts": ordered]) }
            }
        }
    }

    @objc func readDraft(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), let draftId = call.getString("draftId") else {
            call.reject("capture_arguments_required")
            return
        }
        do {
            let (draft, data) = try CaptureCoordinator.shared.read(ownerUid: ownerUid, draftId: draftId)
            var result: [String: Any] = [
                "draftId": draft.id,
                "assetId": draft.id,
                "mime": draft.mime,
                "durationMs": draft.durationMilliseconds,
                "base64": data.base64EncodedString(),
            ]

            if draft.durationMilliseconds > 0 {
                result["durationMilliseconds"] = draft.durationMilliseconds
                call.resolve(result)
            } else if let url = try? CaptureCoordinator.shared.audioURL(ownerUid: ownerUid, draftId: draft.id) {
                loadDurationMilliseconds(url: url) { ms in
                    result["durationMilliseconds"] = ms
                    DispatchQueue.main.async { call.resolve(result) }
                }
            } else {
                result["durationMilliseconds"] = 0
                call.resolve(result)
            }
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func deleteDraft(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), let draftId = call.getString("draftId") else {
            call.reject("capture_arguments_required")
            return
        }
        do {
            try CaptureCoordinator.shared.delete(ownerUid: ownerUid, draftId: draftId)
            call.resolve()
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func updateDraftStatus(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"),
              let draftId = call.getString("draftId"),
              let statusRaw = call.getString("status") else {
            call.reject("capture_arguments_required")
            return
        }
        guard let status = CaptureDraft.Status(rawValue: statusRaw) else {
            call.reject("capture_invalid_status")
            return
        }
        do {
            try CaptureCoordinator.shared.updateStatus(ownerUid: ownerUid, draftId: draftId, status: status)
            call.resolve(["draftId": draftId, "status": status.rawValue])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func enqueueUpload(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"),
              let draftId = call.getString("draftId"),
              let signedUrlString = call.getString("signedUrl"),
              let signedUrl = URL(string: signedUrlString) else {
            call.reject("capture_arguments_required")
            return
        }
        let contentType = call.getString("contentType") ?? "audio/mp4"
        do {
            let fileURL = try CaptureCoordinator.shared.audioURL(ownerUid: ownerUid, draftId: draftId)
            let ownerHash = try CaptureCoordinator.shared.ownerHash(ownerUid)
            BackgroundUploader.shared.enqueueUpload(
                draftId: draftId,
                ownerHash: ownerHash,
                fileURL: fileURL,
                signedUrl: signedUrl,
                contentType: contentType
            )
            call.resolve(["draftId": draftId])
        } catch { call.reject(error.localizedDescription) }
    }

    // MARK: - Background upload event forwarding

    @objc private func handleUploadProgress(_ note: Notification) {
        guard let info = note.userInfo,
              let draftId = info[BackgroundUploader.draftIdKey] as? String else { return }
        let progress = info[BackgroundUploader.progressKey] as? Double ?? 0
        notifyListeners("captureUploadProgress", data: ["draftId": draftId, "progress": progress])
    }

    @objc private func handleUploadComplete(_ note: Notification) {
        guard let info = note.userInfo,
              let draftId = info[BackgroundUploader.draftIdKey] as? String else { return }
        let httpStatus = info[BackgroundUploader.httpStatusKey] as? Int ?? 0
        notifyListeners("captureUploadComplete", data: ["draftId": draftId, "httpStatus": httpStatus])
    }

    @objc private func handleUploadFailed(_ note: Notification) {
        guard let info = note.userInfo,
              let draftId = info[BackgroundUploader.draftIdKey] as? String else { return }
        let errorCode = info[BackgroundUploader.errorCodeKey] as? String ?? "unknown"
        notifyListeners("captureUploadFailed", data: ["draftId": draftId, "errorCode": errorCode])
    }

    // MARK: - Duration derivation

    /// Asynchronously load a recording's duration (ms) from its file. Uses the
    /// iOS 15-compatible `loadValuesAsynchronously`; any failure yields 0.
    private func loadDurationMilliseconds(url: URL, completion: @escaping (Int) -> Void) {
        let asset = AVURLAsset(url: url)
        asset.loadValuesAsynchronously(forKeys: ["duration"]) {
            var error: NSError?
            let status = asset.statusOfValue(forKey: "duration", error: &error)
            guard status == .loaded else { completion(0); return }
            let seconds = CMTimeGetSeconds(asset.duration)
            guard seconds.isFinite, seconds > 0 else { completion(0); return }
            completion(Int((seconds * 1000).rounded()))
        }
    }
}
