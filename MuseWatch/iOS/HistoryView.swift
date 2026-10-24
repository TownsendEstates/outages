import SwiftUI

struct HistoryView: View {
    @Environment(ConversationStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.conversations.filter { !$0.messages.isEmpty }) { convo in
                    NavigationLink {
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                ForEach(convo.messages) { MessageBubble(message: $0) }
                            }
                            .padding()
                        }
                        .navigationTitle(convo.title)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            Button("Continue") { store.currentID = convo.id }
                        }
                    } label: {
                        VStack(alignment: .leading) {
                            Text(convo.title).lineLimit(2)
                            Text(convo.updated, style: .relative).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { offsets in
                    let visible = store.conversations.filter { !$0.messages.isEmpty }
                    offsets.map { visible[$0].id }.forEach(store.delete)
                }
            }
            .overlay {
                if store.conversations.allSatisfy({ $0.messages.isEmpty }) {
                    ContentUnavailableView("No conversations yet", systemImage: "bubble.left")
                }
            }
            .navigationTitle("History")
        }
    }
}
