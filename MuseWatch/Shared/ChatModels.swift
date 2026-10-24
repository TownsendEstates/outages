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
        load()
    }

    /// True when the history file exists but couldn't be read yet (e.g. the iPhone app was woken
    /// in the background by the watch while the phone was locked). Saving is blocked until it loads,
    /// so a locked launch can never overwrite real history with an empty list.
    private var pendingLoad = false

    private func load() {
        guard FileManager.default.fileExists(atPath: fileURL.path()) else { pendingLoad = false; return }
        if let data = try? Data(contentsOf: fileURL),
           let saved = try? JSONDecoder().decode([Conversation].self, from: data) {
            let unsaved = conversations.filter { convo in !saved.contains { $0.id == convo.id } }
            conversations = unsaved + saved
            pendingLoad = false
        } else {
            pendingLoad = true
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
        if pendingLoad { load() }
        guard !pendingLoad, let data = try? JSONEncoder().encode(conversations) else { return }
        #if os(iOS)
        // History is only written from the foreground on iPhone, so use the strongest class:
        // unreadable whenever the phone is locked.
        let protection: Data.WritingOptions = .completeFileProtection
        #else
        // The watch may finish a reply just as the wrist drops; keep it writable after first unlock.
        let protection: Data.WritingOptions = .completeFileProtectionUntilFirstUserAuthentication
        #endif
        do {
            try data.write(to: fileURL, options: [.atomic, protection])
            var url = fileURL
            var values = URLResourceValues()
            values.isExcludedFromBackup = true // keep chats out of iCloud/computer backups
            try? url.setResourceValues(values)
        } catch {
            // Locked mid-write: the in-memory copy is kept and saved on the next change or when the app returns.
        }
    }

    /// Call when the app comes back to the foreground: loads history a locked launch couldn't read,
    /// then flushes anything a locked write missed.
    func refresh() {
        if pendingLoad { load() }
        save()
    }
}
