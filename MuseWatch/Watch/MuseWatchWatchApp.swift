import SwiftUI

@main
struct MuseWatchWatchApp: App {
    @State private var store = ConversationStore(limit: 25)
    @StateObject private var sync = WatchSync.shared

    init() {
        WatchSync.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            WatchHomeView()
                .environment(store)
                .environmentObject(sync)
                .tint(Theme.amber)
        }
    }
}
