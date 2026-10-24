import SwiftUI
import WatchKit

struct WatchConversationView: View {
    let conversationID: UUID

    @Environment(ConversationStore.self) private var store
    @StateObject private var speaker = Speaker.shared
    @State private var isSending = false
    @State private var errorText: String?
    @State private var followUp = ""

    private var messages: [ChatMessage] {
        store.conversations.first { $0.id == conversationID }?.messages ?? []
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(messages) { message in
                        Text(message.text)
                            .font(message.role == .user ? .footnote : .body)
                            .foregroundStyle(message.role == .user ? Theme.amber : .primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(message.role == .assistant ? 8 : 0)
                            .background(message.role == .assistant ? Theme.blue.opacity(0.25) : .clear,
                                        in: RoundedRectangle(cornerRadius: 10))
                            .id(message.id)
                    }

                    if isSending {
                        HStack { ProgressView().frame(width: 20); Text("Thinking…").font(.footnote) }
                            .id("thinking")
                    }

                    if let errorText {
                        Text(errorText).font(.footnote).foregroundStyle(.red)
                        Button("Retry") { Task { await fetchReply() } }
                    }

                    if !isSending {
                        HStack {
                            if let last = messages.last, last.role == .assistant {
                                Button {
                                    speaker.isSpeaking ? speaker.stop() : speaker.speak(last.text)
                                } label: {
                                    Image(systemName: speaker.isSpeaking ? "stop.fill" : "speaker.wave.2.fill")
                                }
                            }
                        }
                        TextField("Follow up", text: $followUp)
                            .onSubmit { Task { await sendFollowUp() } }
                            .id("followup")
                    }
                }
            }
            .onChange(of: messages.count) {
                withAnimation { proxy.scrollTo(messages.last?.id, anchor: .top) }
            }
        }
        .navigationTitle("Muse")
        .task { await fetchReplyIfNeeded() }
        .onDisappear { speaker.stop() }
    }

    private func fetchReplyIfNeeded() async {
        if messages.last?.role == .user { await fetchReply() }
    }

    private func sendFollowUp() async {
        let text = followUp.trimmingCharacters(in: .whitespacesAndNewlines)
        followUp = ""
        guard !text.isEmpty else { return }
        store.append(ChatMessage(role: .user, text: text), to: conversationID)
        await fetchReply()
    }

    private func fetchReply() async {
        guard !isSending else { return }
        isSending = true
        errorText = nil
        defer { isSending = false }
        do {
            let reply = try await MuseRouter.ask(messages)
            store.append(ChatMessage(role: .assistant, text: reply), to: conversationID)
            WKInterfaceDevice.current().play(.success)
            if ConfigStore.load().autoSpeakOnWatch { speaker.speak(reply) }
        } catch {
            errorText = error.localizedDescription
            WKInterfaceDevice.current().play(.failure)
        }
    }
}
