import AppIntents
import UIKit

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
