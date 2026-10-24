import SwiftUI

@main
struct MuseWatchApp: App {
    @State private var store = ConversationStore()
    @StateObject private var sync = WatchSync.shared

    init() {
        // Activate early so the watch can wake this app in the background to relay requests.
        WatchSync.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                ChatView()
                    .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
                HistoryView()
                    .tabItem { Label("History", systemImage: "clock") }
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .tint(Theme.blue)
            .environment(store)
            .environmentObject(sync)
        }
    }
}
