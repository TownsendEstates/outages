import AppIntents
import Foundation

/// Picks the best route to Muse for the current device.
/// On the watch: direct over Wi-Fi/LTE first, then relay through the iPhone.
enum MuseRouter {
    static func ask(_ messages: [ChatMessage]) async throws -> String {
        #if os(watchOS)
        let client = MuseClient()
        if client.apiKey?.isEmpty == false {
            do {
                return try await client.send(messages, fromWatch: true)
            } catch MuseError.network(let detail) {
                if WatchSync.shared.canRelay { return try await WatchSync.shared.relayAsk(messages) }
                throw MuseError.network(detail)
            }
        }
        return try await WatchSync.shared.relayAsk(messages)
        #else
        return try await MuseClient().send(messages, fromWatch: false)
        #endif
    }
}

/// "Hey Siri, ask Muse …" — works on iPhone and Apple Watch, and in the Shortcuts app.
struct AskMuseIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Muse"
    static var description = IntentDescription("Ask your Muse AI agent a question and hear the answer.")

    @Parameter(title: "Question", requestValueDialog: "What do you want to ask Muse?")
    var question: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask Muse \(\.$question)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let reply = try await MuseRouter.ask([ChatMessage(role: .user, text: question)])
        return .result(value: reply, dialog: IntentDialog(stringLiteral: reply))
    }
}

struct MuseShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskMuseIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask \(.applicationName) a question",
                "Talk to \(.applicationName)"
            ],
            shortTitle: "Ask Muse",
            systemImageName: "sparkles"
        )
    }
}
