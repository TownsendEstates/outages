import SwiftUI

struct WatchHomeView: View {
    @Environment(ConversationStore.self) private var store
    @EnvironmentObject private var sync: WatchSync
    @State private var path: [UUID] = []
    @State private var draft = ""
    @State private var config = ConfigStore.load()
    @State private var avatar = AvatarStore.load()

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    HStack(spacing: 10) {
                        AvatarView(image: avatar, size: 44)
                        VStack(alignment: .leading) {
                            Text(config.agentName).font(.headline)
                            Text("Tap below to ask").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .listRowBackground(Color.clear)
                }

                Section {
                    // Tapping opens the system input sheet: dictation, Scribble or keyboard.
                    TextField("Ask \(config.agentName)", text: $draft)
                        .onSubmit { start(draft) }
                        .foregroundStyle(Theme.amber)
                } footer: {
                    if KeychainStore.apiKey == nil && !sync.isReachable {
                        Text("Open Muse Watch on your iPhone and add your API key in Settings.")
                    }
                }

                if !config.quickPrompts.isEmpty {
                    Section("Quick") {
                        ForEach(config.quickPrompts, id: \.self) { prompt in
                            Button(prompt) { start(prompt) }
                                .font(.footnote)
                        }
                    }
                }

                let recent = store.conversations.filter { !$0.messages.isEmpty }
                if !recent.isEmpty {
                    Section("Recent") {
                        ForEach(recent) { convo in
                            NavigationLink(value: convo.id) {
                                Text(convo.title).font(.footnote).lineLimit(2)
                            }
                        }
                        .onDelete { offsets in offsets.map { recent[$0].id }.forEach(store.delete) }
                    }
                }
            }
            .navigationDestination(for: UUID.self) { WatchConversationView(conversationID: $0) }
        }
        .onReceive(sync.$lastSync) { _ in config = ConfigStore.load() }
        .onReceive(sync.$avatarVersion) { _ in avatar = AvatarStore.load() }
        .onOpenURL { _ in path = [] } // complication tap lands on the Ask field
    }

    private func start(_ text: String) {
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        guard !question.isEmpty else { return }
        let id = store.startNew()
        store.append(ChatMessage(role: .user, text: question), to: id)
        path = [id]
    }
}
