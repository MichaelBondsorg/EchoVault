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
        let data = audio.data
        try data.write(to: inbox.appendingPathComponent("\(id).m4a"))
        let meta: [String: Any] = [
            "capturedAt": ISO8601DateFormatter().string(from: Date()),
            "mime": "audio/mp4"
        ]
        let metaData = try JSONSerialization.data(withJSONObject: meta)
        try metaData.write(to: inbox.appendingPathComponent("\(id).json"))
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
