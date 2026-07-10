// Target: EngramWidget extension ONLY (declares @main — never add to the App target). Set the extension's deployment target to iOS 17+ (containerBackground(for:) requires it).
import WidgetKit
import SwiftUI

struct CaptureEntry: TimelineEntry {
    let date: Date
}

struct CaptureProvider: TimelineProvider {
    func placeholder(in context: Context) -> CaptureEntry { CaptureEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (CaptureEntry) -> Void) {
        completion(CaptureEntry(date: .now))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CaptureEntry>) -> Void) {
        completion(Timeline(entries: [CaptureEntry(date: .now)], policy: .never))
    }
}

struct EngramCaptureWidgetView: View {
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill")
                    .font(.title2)
            }
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: "mic.fill")
                VStack(alignment: .leading) {
                    Text("Brain dump").font(.headline)
                    Text("Tap to talk").font(.caption2).opacity(0.7)
                }
            }
        default: // systemSmall
            VStack(spacing: 10) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 34, weight: .semibold))
                Text("Brain dump")
                    .font(.subheadline.weight(.medium))
            }
        }
    }
}

struct EngramCaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EngramCapture", provider: CaptureProvider()) { _ in
            EngramCaptureWidgetView()
                .widgetURL(URL(string: "engram://capture?mode=voice"))
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Quick Capture")
        .description("One tap to start a brain dump.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct EngramWidgetBundle: WidgetBundle {
    var body: some Widget {
        EngramCaptureWidget()
    }
}
