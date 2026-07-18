import AppIntents
import Foundation

private let pendingCaptureModeKey = "engram.pendingCaptureMode"

@available(iOS 16.0, *)
struct RecordEngramIntent: AppIntent {
    static var title: LocalizedStringResource = "Record an Engram"
    static var description = IntentDescription("Open Engram directly in secure voice capture.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set("voice", forKey: pendingCaptureModeKey)
        return .result()
    }
}

@available(iOS 16.0, *)
struct WriteEngramIntent: AppIntent {
    static var title: LocalizedStringResource = "Write an Engram"
    static var description = IntentDescription("Open Engram directly in the private text editor.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set("text", forKey: pendingCaptureModeKey)
        return .result()
    }
}

@available(iOS 16.0, *)
struct EngramAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: RecordEngramIntent(),
            phrases: ["Record an entry in \(.applicationName)", "Capture a thought in \(.applicationName)"],
            shortTitle: "Record Entry",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: WriteEngramIntent(),
            phrases: ["Write an entry in \(.applicationName)"],
            shortTitle: "Write Entry",
            systemImageName: "square.and.pencil"
        )
    }
}
