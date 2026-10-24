import SwiftUI
import UniformTypeIdentifiers

struct ChatView: View {
    @Environment(ConversationStore.self) private var store
    @State private var draft = ""
    @State private var isSending = false
    @State private var errorText: String?
    @FocusState private var focused: Bool
    @EnvironmentObject private var sync: WatchSync
    @State private var avatar = AvatarStore.load()

    private var config: MuseConfig { ConfigStore.load() }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if store.current?.messages.isEmpty ?? true {
                                EmptyChat(avatar: avatar, prompts: config.quickPrompts) { draft = $0; focused = true }
                            }
                            ForEach(store.current?.messages ?? []) { message in
                                MessageBubble(message: message, avatar: avatar).id(message.id)
                            }
                            if isSending {
                                HStack(spacing: 8) {
                                    AvatarView(image: avatar, size: 28, thinking: true)
                                    Text("\(config.agentName) is thinking…").foregroundStyle(.secondary)
                                }
                                .id("thinking")
                            }
                            if let errorText {
                                Label(errorText, systemImage: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.red)
                                    .font(.footnote)
                                    .id("error")
                            }
                        }
                        .padding()
                    }
                    .onChange(of: store.current?.messages.count) {
                        withAnimation { proxy.scrollTo(store.current?.messages.last?.id, anchor: .bottom) }
                    }
                }

                Divider()
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Ask \(config.agentName)…", text: $draft, axis: .vertical)
                        .lineLimit(1...6)
                        .textFieldStyle(.roundedBorder)
                        .focused($focused)
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.title)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
                }
                .padding()
            }
            .navigationTitle(config.agentName)
            .onReceive(sync.$avatarVersion) { _ in avatar = AvatarStore.load() }
            .onAppear { avatar = AvatarStore.load() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { store.startNew(); errorText = nil } label: { Image(systemName: "square.and.pencil") }
                }
            }
        }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let id = store.currentID ?? store.startNew()
        store.append(ChatMessage(role: .user, text: text), to: id)
        draft = ""
        errorText = nil
        isSending = true
        defer { isSending = false }
        do {
            let history = store.conversations.first { $0.id == id }?.messages ?? []
            let reply = try await MuseRouter.ask(history)
            store.append(ChatMessage(role: .assistant, text: reply), to: id)
        } catch {
            errorText = error.localizedDescription
        }
    }
}

private struct EmptyChat: View {
    let avatar: UIImage?
    let prompts: [String]
    let pick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            AvatarView(image: avatar, size: 64)
            Text("Ask anything — your conversations here and on your Apple Watch use the same Muse agent.")
                .foregroundStyle(.secondary)
            ForEach(prompts, id: \.self) { prompt in
                Button(prompt) { pick(prompt) }
                    .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 24)
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    var avatar: UIImage? = AvatarStore.load()

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .user { Spacer(minLength: 40) }
            if message.role == .assistant { AvatarView(image: avatar, size: 28) }
            Text(LocalizedStringKey(message.text)) // renders basic markdown
                .textSelection(.enabled)
                .padding(12)
                .background(message.role == .user ? Theme.blue : Color(.secondarySystemBackground),
                            in: RoundedRectangle(cornerRadius: 16))
                .foregroundStyle(message.role == .user ? .white : .primary)
                .contextMenu {
                    Button("Copy", systemImage: "doc.on.doc") {
                        // Clears itself from the clipboard after 5 minutes.
                        UIPasteboard.general.setItems([[UTType.plainText.identifier: message.text]],
                                                      options: [.expirationDate: Date().addingTimeInterval(300)])
                    }
                    ShareLink(item: message.text)
                }
            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }
}
