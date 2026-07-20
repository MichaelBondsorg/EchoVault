import Foundation

/// Background upload driver for captured audio (plan task B5, native half).
///
/// Wraps a single `URLSession` created with a *background* configuration so an
/// uploaded `.m4a` finishes transferring even if the app is suspended or
/// terminated mid-upload. Uploads go straight to a Cloud Storage V4 signed URL
/// (issued by the `issueCaptureUploadTicket` callable) via `PUT`, so audio
/// bytes never traverse the WebView bridge as base64.
///
/// Background-URLSession contract honoured here:
///  - The session is created ONCE per identifier with a delegate and reused;
///    recreating it with the same identifier on relaunch reattaches to tasks
///    that completed while the app was suspended (see `activate()`).
///  - Only `uploadTask(with:fromFile:)` is used — background sessions do not
///    support data tasks or completion-handler-based tasks.
///  - Completion, progress, and the "all events delivered" callback are handled
///    via delegate methods; `taskDescription` carries the draftId so results can
///    be correlated after a relaunch (the in-memory closure map would be gone).
///  - On `urlSessionDidFinishEvents` we invoke the system completion handler
///    stored by `AppDelegate.application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
///
/// Results are broadcast via `NotificationCenter`; `CapturePlugin` observes them
/// and forwards `captureUploadProgress` / `captureUploadComplete` /
/// `captureUploadFailed` events to JS.
final class BackgroundUploader: NSObject {
    static let shared = BackgroundUploader()

    static let sessionIdentifier = "engram.capture.upload"

    // NotificationCenter channel consumed by CapturePlugin.
    static let progressNotification = Notification.Name("engram.capture.upload.progress")
    static let completeNotification = Notification.Name("engram.capture.upload.complete")
    static let failedNotification = Notification.Name("engram.capture.upload.failed")

    // userInfo keys.
    static let draftIdKey = "draftId"
    static let httpStatusKey = "httpStatus"
    static let errorCodeKey = "errorCode"
    static let progressKey = "progress"

    /// System completion handler from `handleEventsForBackgroundURLSession`.
    /// Must be called (on the main thread) once all background events for the
    /// session have been delivered, or iOS will penalise future background time.
    private var backgroundCompletionHandler: (() -> Void)?

    /// Lazily-created background session. `lazy` guarantees exactly one instance
    /// per identifier for this process; touching it (via `activate()`) recreates
    /// it after a relaunch so its delegate receives pending completion events.
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: BackgroundUploader.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() { super.init() }

    /// Force the background session (and thus its delegate) to exist. Call early
    /// in app launch so tasks that finished while the app was dead can deliver
    /// their delegate callbacks.
    func activate() {
        _ = session
    }

    /// Enqueue a background PUT upload of `fileURL` to `signedUrl`.
    /// - Parameter headers: extra request headers that were signed into the V4
    ///   URL (e.g. `x-goog-meta-*` capture provenance). These MUST match exactly
    ///   what `issueCaptureUploadTicket` returned in `requiredHeaders`, or GCS
    ///   rejects the PUT with SignatureDoesNotMatch.
    /// - Note: `taskDescription` is set to `draftId` so the completion delegate
    ///   can identify the draft even after an app relaunch.
    func enqueueUpload(
        draftId: String,
        ownerHash: String,
        fileURL: URL,
        signedUrl: URL,
        contentType: String,
        headers: [String: String] = [:]
    ) {
        var request = URLRequest(url: signedUrl)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let task = session.uploadTask(with: request, fromFile: fileURL)
        task.taskDescription = draftId
        task.resume()
    }

    /// Store the system-provided completion handler and ensure the session is
    /// alive to flush pending events.
    func setBackgroundCompletionHandler(_ handler: @escaping () -> Void) {
        backgroundCompletionHandler = handler
        _ = session
    }
}

extension BackgroundUploader: URLSessionDataDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard let draftId = task.taskDescription else { return }
        let progress: Double = totalBytesExpectedToSend > 0
            ? Double(totalBytesSent) / Double(totalBytesExpectedToSend)
            : 0
        NotificationCenter.default.post(
            name: BackgroundUploader.progressNotification,
            object: nil,
            userInfo: [
                BackgroundUploader.draftIdKey: draftId,
                BackgroundUploader.progressKey: progress,
            ]
        )
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let draftId = task.taskDescription ?? ""

        if let error = error {
            // Transport-level failure (no HTTP response, e.g. lost connectivity).
            NotificationCenter.default.post(
                name: BackgroundUploader.failedNotification,
                object: nil,
                userInfo: [
                    BackgroundUploader.draftIdKey: draftId,
                    BackgroundUploader.errorCodeKey: "transport_\((error as NSError).code)",
                ]
            )
            return
        }

        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if (200...299).contains(status) {
            NotificationCenter.default.post(
                name: BackgroundUploader.completeNotification,
                object: nil,
                userInfo: [
                    BackgroundUploader.draftIdKey: draftId,
                    BackgroundUploader.httpStatusKey: status,
                ]
            )
        } else {
            NotificationCenter.default.post(
                name: BackgroundUploader.failedNotification,
                object: nil,
                userInfo: [
                    BackgroundUploader.draftIdKey: draftId,
                    BackgroundUploader.errorCodeKey: "http_\(status)",
                    BackgroundUploader.httpStatusKey: status,
                ]
            )
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        // The system completion handler MUST be invoked on the main thread.
        DispatchQueue.main.async {
            let handler = self.backgroundCompletionHandler
            self.backgroundCompletionHandler = nil
            handler?()
        }
    }
}
