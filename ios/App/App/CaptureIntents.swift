// Target: App (main). Requires iOS 17+ availability annotations because the App target deploys to iOS 15.
import AppIntents
import UIKit

@available(iOS 17.0, *)
struct StartBrainDumpIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a Brain Dump"
    static var description = IntentDescription("Opens Engram and starts recording immediately.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // Route through the same deep-link path the widget uses so behavior stays identical.
        if let url = URL(string: "engram://capture?mode=voice") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

// Written by the iOS Shortcuts "Record Audio" action piping into this intent.
// Deliberately openAppWhenRun = false: the whole point is that Engram never
// opens. The recording lands in the inbox and is swept into the transcription
// pipeline on next launch/foreground (see src/services/audio/captureInbox.js),
// with the entry timestamped at capture time via the capturedAt sidecar field.
@available(iOS 17.0, *)
struct SaveBrainDumpIntent: AppIntent {
    static var title: LocalizedStringResource = "Save Brain Dump Audio"
    static var description = IntentDescription("Saves a recording into Engram for transcription on next open. Works without opening the app.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Audio", supportedContentTypes: [.audio, .mpeg4Audio])
    var audio: IntentFile

    func perform() async throws -> some IntentResult {
        let fm = FileManager.default
        guard let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else {
            throw NSError(domain: "Engram", code: 1)
        }
        // Capacitor's Directory.Data maps to the Documents directory on iOS,
        // so writing here makes the file visible to Filesystem.readdir() from
        // the JS side without any native plugin bridging.
        let inbox = docs.appendingPathComponent("engram-inbox", isDirectory: true)
        try fm.createDirectory(at: inbox, withIntermediateDirectories: true)
        let id = UUID().uuidString
        // IntentFile.data is the stored (already-loaded) Data for the file;
        // no async accessor needed here.
        //
        // Order matters: write the .m4a FIRST, then the .json sidecar LAST,
        // and use .atomic writes for both so a crash mid-write never leaves
        // a half-written file on disk. sweepCaptureInbox() (JS side) treats
        // a sidecar-less .m4a as processable (falls back to default
        // capturedAt/mime), so a crash after the m4a write but before the
        // json write just loses the capture-time metadata for that one
        // recording — harmless. The reverse order would be worse: a crash
        // after a json-first write but before the m4a write leaves a
        // dangling sidecar with no audio to ever pair it with.
        let data = audio.data
        try data.write(to: inbox.appendingPathComponent("\(id).m4a"), options: .atomic)
        let meta: [String: Any] = [
            "capturedAt": ISO8601DateFormatter().string(from: Date()),
            "mime": "audio/mp4"
        ]
        let metaData = try JSONSerialization.data(withJSONObject: meta)
        try metaData.write(to: inbox.appendingPathComponent("\(id).json"), options: .atomic)
        return .result()
    }
}

@available(iOS 17.0, *)
struct EngramShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartBrainDumpIntent(),
            phrases: [
                "Start a brain dump in \(.applicationName)",
                "Add a note in \(.applicationName)",
                "New thought in \(.applicationName)"
            ],
            shortTitle: "Brain Dump",
            systemImageName: "mic.fill"
        )
    }
}
