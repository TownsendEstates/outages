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
    @Environment(\.widgetRenderingMode) private var renderingMode
    private let avatar = AvatarStore.load()

    var body: some View {
        switch family {
        case .accessoryRectangular:
            HStack(spacing: 8) {
                avatarImage(size: 40)
                VStack(alignment: .leading) {
                    Text("Muse").font(.headline).widgetAccentable()
                    Text("Tap to ask").font(.caption).foregroundStyle(.secondary)
                }
            }
        case .accessoryInline:
            Label("Ask Muse", systemImage: "sparkles")
        case .accessoryCorner:
            avatarImage(size: 32)
                .widgetLabel("Muse")
        default:
            ZStack {
                AccessoryWidgetBackground()
                avatarImage(size: 44)
            }
        }
    }

    /// Photo avatar in full colour; tinted watch faces tint it automatically.
    @ViewBuilder
    private func avatarImage(size: CGFloat) -> some View {
        if let avatar {
            Image(uiImage: avatar)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            Image(systemName: "sparkles")
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(renderingMode == .fullColor ? Theme.amber : .primary)
                .widgetAccentable()
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
