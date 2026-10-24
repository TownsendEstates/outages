import Foundation
import WatchConnectivity
#if os(watchOS)
import WidgetKit
#endif

/// Phone ⇄ Watch link.
/// - Config and avatar go via application context (latest-wins, delivered in the background).
/// - The API key is only ever sent by live `sendMessage`, which WatchConnectivity keeps in memory,
///   so it is never written into WatchConnectivity's on-disk context store.
/// - The watch can relay a request through the iPhone when it can't reach the internet itself.
///   The iPhone app is woken in the background to answer.
final class WatchSync: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSync()

    @Published private(set) var isReachable = false
    @Published private(set) var isPaired = false
    @Published private(set) var isWatchAppInstalled = false
    @Published private(set) var lastSync: Date?
    /// Bumped whenever the avatar changes so views reload it.
    @Published private(set) var avatarVersion = 0

    private enum Key {
        static let type = "type"
        static let config = "config"
        static let avatar = "avatar"
        static let apiKey = "apiKey"
        static let messages = "messages"
        static let text = "text"
        static let error = "error"
        static let sentAt = "sentAt"
    }

    private enum Kind {
        static let ask = "ask"
        static let requestKey = "requestKey"
        static let setKey = "setKey"
    }

    /// Limits on what the iPhone will relay, so a misbehaving request can't run up the API bill.
    private enum RelayLimit {
        static let messages = 40
        static let characters = 24_000
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: - Shared delegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        refreshState(session)
        guard state == .activated else { return }
        #if os(iOS)
        pushToWatch()
        #else
        apply(session.receivedApplicationContext)
        if KeychainStore.apiKey == nil { requestKey() }
        #endif
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        refreshState(session)
        #if os(iOS)
        if session.isReachable { sendKeyToWatch() }
        #else
        if session.isReachable && KeychainStore.apiKey == nil { requestKey() }
        #endif
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

    /// Sends config + avatar (background) and the API key (live, if the watch is reachable).
    func pushToWatch() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        var context: [String: Any] = [Key.sentAt: Date().timeIntervalSince1970]
        if let data = try? JSONEncoder().encode(ConfigStore.load()) { context[Key.config] = data }
        context[Key.avatar] = AvatarStore.loadData() ?? Data()
        do {
            try session.updateApplicationContext(context)
            DispatchQueue.main.async { self.lastSync = Date() }
        } catch {
            print("WatchSync context push failed: \(error.localizedDescription)")
        }
        sendKeyToWatch()
    }

    /// An empty key tells the watch to delete its copy.
    func sendKeyToWatch() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage([Key.type: Kind.setKey, Key.apiKey: KeychainStore.apiKey ?? ""],
                            replyHandler: nil, errorHandler: nil)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        switch message[Key.type] as? String {
        case Kind.requestKey:
            replyHandler([Key.apiKey: KeychainStore.apiKey ?? ""])
        case Kind.ask:
            guard let data = message[Key.messages] as? Data,
                  let messages = try? JSONDecoder().decode([ChatMessage].self, from: data),
                  !messages.isEmpty,
                  messages.count <= RelayLimit.messages,
                  messages.reduce(0, { $0 + $1.text.count }) <= RelayLimit.characters else {
                replyHandler([Key.error: "Request from watch was too large or malformed."])
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

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if message[Key.type] as? String == Kind.setKey, let key = message[Key.apiKey] as? String {
            KeychainStore.apiKey = key
            DispatchQueue.main.async { self.lastSync = Date() }
        }
    }

    private func apply(_ context: [String: Any]) {
        guard !context.isEmpty else { return }
        if let data = context[Key.config] as? Data,
           let config = try? JSONDecoder().decode(MuseConfig.self, from: data) {
            ConfigStore.save(config)
        }
        if let avatar = context[Key.avatar] as? Data {
            AvatarStore.save(avatar)
            WidgetCenter.shared.reloadAllTimelines()
            DispatchQueue.main.async { self.avatarVersion += 1 }
        }
        DispatchQueue.main.async { self.lastSync = Date() }
    }

    /// Asks the phone for the API key (first launch, or after the phone changed it while out of range).
    func requestKey() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage([Key.type: Kind.requestKey], replyHandler: { [weak self] reply in
            if let key = reply[Key.apiKey] as? String {
                KeychainStore.apiKey = key
                DispatchQueue.main.async { self?.lastSync = Date() }
            }
        }, errorHandler: nil)
    }

    var canRelay: Bool {
        WCSession.default.activationState == .activated && WCSession.default.isReachable
    }

    /// Runs the request on the iPhone and returns the reply.
    func relayAsk(_ messages: [ChatMessage]) async throws -> String {
        guard canRelay else { throw MuseError.network("iPhone not reachable.") }
        let data = try JSONEncoder().encode(Array(messages.suffix(RelayLimit.messages)))
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
