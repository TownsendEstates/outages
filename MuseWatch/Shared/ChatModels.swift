import Foundation
import Observation

struct ChatMessage: Codable, Identifiable, Equatable {
    enum Role: String, Codable { case user, assistant }

    var id = UUID()
    var role: Role
    var text: String
    var date = Date()
}

struct Conversation: Codable, Identifiable, Equatable {
    var id = UUID()
    var messages: [ChatMessage] = []
    var updated = Date()

    var title: String {
        let first = messages.first { $0.role == .user }?.text ?? "New conversation"
        return first.count > 60 ? String(first.prefix(60)) + "…" : first
    }
}

/// Local conversation history, saved as JSON in the app's Documents folder.
/// The phone and watch each keep their own history.
@Observable
final class ConversationStore {
    private(set) var conversations: [Conversation] = []
    var currentID: UUID?

    /// Keep history small on the watch.
    private let limit: Int
    private let fileURL: URL

    init(limit: Int = 100) {
        self.limit = limit
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        fileURL = dir.appending(path: "conversations.json")
        if let data = try? Data(contentsOf: fileURL),
           let saved = try? JSONDecoder().decode([Conversation].self, from: data) {
            conversations = saved
        }
    }

    var current: Conversation? {
        conversations.first { $0.id == currentID }
    }

    @discardableResult
    func startNew() -> UUID {
        let convo = Conversation()
        conversations.insert(convo, at: 0)
        currentID = convo.id
        trimAndSave()
        return convo.id
    }

    func append(_ message: ChatMessage, to id: UUID) {
        guard let index = conversations.firstIndex(where: { $0.id == id }) else { return }
        conversations[index].messages.append(message)
        conversations[index].updated = Date()
        // Most recent conversation first.
        let convo = conversations.remove(at: index)
        conversations.insert(convo, at: 0)
        trimAndSave()
    }

    func delete(_ id: UUID) {
        conversations.removeAll { $0.id == id }
        if currentID == id { currentID = nil }
        save()
    }

    func deleteAll() {
        conversations = []
        currentID = nil
        save()
    }

    private func trimAndSave() {
        conversations.removeAll { $0.messages.isEmpty && $0.id != currentID }
        if conversations.count > limit { conversations = Array(conversations.prefix(limit)) }
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(conversations) {
            try? data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }
}
