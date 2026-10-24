import SwiftUI
import WidgetKit

/// Watch-face complication: one tap opens Muse straight to the Ask field.
struct MuseEntry: TimelineEntry {
    let date: Date
}

struct MuseProvider: TimelineProvider {
    func placeholder(in context: Context) -> MuseEntry { MuseEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (MuseEntry) -> Void) { completion(MuseEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<MuseEntry>) -> Void) {
        completion(Timeline(entries: [MuseEntry(date: .now)], policy: .never))
    }
}

struct MuseComplicationView: View {
    @Environment(\.widgetFamily) private var family
    private let amber = Color(red: 244 / 255, green: 162 / 255, blue: 37 / 255)

    var body: some View {
        switch family {
        case .accessoryRectangular:
            HStack {
                Image(systemName: "sparkles").font(.title3).foregroundStyle(amber)
                VStack(alignment: .leading) {
                    Text("Muse").font(.headline)
                    Text("Tap to ask").font(.caption).foregroundStyle(.secondary)
                }
            }
        case .accessoryInline:
            Label("Ask Muse", systemImage: "sparkles")
        case .accessoryCorner:
            Image(systemName: "sparkles").font(.title2).foregroundStyle(amber)
                .widgetLabel("Muse")
        default:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "sparkles").font(.title2).foregroundStyle(amber)
            }
        }
    }
}

@main
struct MuseComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "MuseComplication", provider: MuseProvider()) { _ in
            MuseComplicationView()
                .containerBackground(.clear, for: .widget)
                .widgetURL(URL(string: "musewatch://ask"))
        }
        .configurationDisplayName("Ask Muse")
        .description("Open your Muse AI agent.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}
