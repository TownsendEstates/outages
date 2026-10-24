import Foundation
import WatchConnectivity

/// Phone ⇄ Watch link.
/// - iPhone pushes the config + API key to the watch whenever Settings change.
/// - Watch can relay a request through the iPhone when it can't reach the internet itself
///   (or has no key yet). The iPhone app is woken in the background to answer.
final class WatchSync: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSync()

    @Published private(set) var isReachable = false
    @Published private(set) var isPaired = false
    @Published private(set) var isWatchAppInstalled = false
    @Published private(set) var lastSync: Date?

    private enum Key {
        static let type = "type"
        static let config = "config"
        static let apiKey = "apiKey"
        static let messages = "messages"
        static let text = "text"
        static let error = "error"
        static let sentAt = "sentAt"
    }

    private enum Kind {
        static let ask = "ask"
        static let requestSync = "requestSync"
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: - Shared delegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        refreshState(session)
        #if os(iOS)
        if state == .activated { pushToWatch() }
        #else
        if state == .activated {
            apply(session.receivedApplicationContext)
            if KeychainStore.apiKey == nil { requestSync() }
        }
        #endif
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        refreshState(session)
    }

    private func refreshState(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
            #if os(iOS)
            self.isPaired = session.isPaired
            self.isWatchAppInstalled = session.isWatchAppInstalled
            #else
            self.isPaired = true
            self.isWatchAppInstalled = true
            #endif
        }
    }

    // MARK: - iPhone side

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
    func sessionWatchStateDidChange(_ session: WCSession) {
        refreshState(session)
        pushToWatch()
    }

    /// Sends the current config and API key to the watch. Safe to call any time.
    func pushToWatch() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        do {
            try session.updateApplicationContext(syncPayload())
            DispatchQueue.main.async { self.lastSync = Date() }
        } catch {
            print("WatchSync push failed: \(error)")
        }
    }

    private func syncPayload() -> [String: Any] {
        var payload: [String: Any] = [Key.sentAt: Date().timeIntervalSince1970]
        if let data = try? JSONEncoder().encode(ConfigStore.load()) { payload[Key.config] = data }
        payload[Key.apiKey] = KeychainStore.apiKey ?? ""
        return payload
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        switch message[Key.type] as? String {
        case Kind.requestSync:
            replyHandler(syncPayload())
        case Kind.ask:
            guard let data = message[Key.messages] as? Data,
                  let messages = try? JSONDecoder().decode([ChatMessage].self, from: data) else {
                replyHandler([Key.error: "Bad request from watch."])
                return
            }
            Task {
                do {
                    let text = try await MuseClient().send(messages, fromWatch: true)
                    replyHandler([Key.text: text])
                } catch {
                    replyHandler([Key.error: error.localizedDescription])
                }
            }
        default:
            replyHandler([Key.error: "Unknown request."])
        }
    }
    #endif

    // MARK: - Watch side

    #if os(watchOS)
    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        apply(context)
    }

    private func apply(_ context: [String: Any]) {
        guard !context.isEmpty else { return }
        if let data = context[Key.config] as? Data,
           let config = try? JSONDecoder().decode(MuseConfig.self, from: data) {
            ConfigStore.save(config)
        }
        if let key = context[Key.apiKey] as? String {
            KeychainStore.apiKey = key
        }
        DispatchQueue.main.async { self.lastSync = Date() }
    }

    /// Asks the phone for the latest settings (used on first launch).
    func requestSync() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage([Key.type: Kind.requestSync], replyHandler: { [weak self] reply in
            self?.apply(reply)
        }, errorHandler: nil)
    }

    var canRelay: Bool {
        WCSession.default.activationState == .activated && WCSession.default.isReachable
    }

    /// Runs the request on the iPhone and returns the reply.
    func relayAsk(_ messages: [ChatMessage]) async throws -> String {
        guard canRelay else { throw MuseError.network("iPhone not reachable.") }
        let data = try JSONEncoder().encode(messages)
        return try await withCheckedThrowingContinuation { continuation in
            WCSession.default.sendMessage([Key.type: Kind.ask, Key.messages: data], replyHandler: { reply in
                if let text = reply[Key.text] as? String {
                    continuation.resume(returning: text)
                } else {
                    continuation.resume(throwing: MuseError.network(reply[Key.error] as? String ?? "No reply from iPhone."))
                }
            }, errorHandler: { error in
                continuation.resume(throwing: MuseError.network(error.localizedDescription))
            })
        }
    }
    #endif
}
