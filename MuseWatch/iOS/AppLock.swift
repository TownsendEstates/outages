import LocalAuthentication
import SwiftUI

/// Face ID / passcode gate for the iPhone app, plus a privacy cover in the app switcher.
/// Background relays for the watch don't go through the UI, so the watch keeps working while this is locked.
struct LockGate<Content: View>: View {
    @ViewBuilder var content: Content

    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("security.requireUnlock") private var requireUnlock = true
    @State private var unlocked = false
    @State private var lastActive = Date.distantPast
    @State private var failed = false
    @State private var authenticating = false

    /// Re-lock after this long in the background.
    private let graceSeconds: TimeInterval = 60

    var body: some View {
        ZStack {
            content
                .opacity(isCovered ? 0 : 1)

            if isCovered {
                LockCover(showUnlock: requireUnlock && !unlocked, failed: failed) { authenticate() }
                    .transition(.opacity)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                lastActive = Date()
                failed = false
            case .active:
                // Re-lock if the app sat in the background longer than the grace period.
                if requireUnlock && unlocked && Date().timeIntervalSince(lastActive) > graceSeconds {
                    unlocked = false
                }
                // After a cancelled attempt, wait for a tap on Unlock instead of re-prompting in a loop.
                if requireUnlock && !unlocked && !failed { authenticate() }
            default:
                break
            }
        }
        .onAppear {
            if requireUnlock { authenticate() } else { unlocked = true }
        }
        .onChange(of: requireUnlock) { _, required in
            if !required { unlocked = true }
        }
    }

    /// Covered when locked, and always while in the app switcher (hides chats from shoulder-surfers and screenshots).
    private var isCovered: Bool {
        (requireUnlock && !unlocked) || scenePhase != .active
    }

    private func authenticate() {
        guard !authenticating else { return }
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"
        var error: NSError?
        // Biometrics with device-passcode fallback. If no passcode is set at all, don't lock the owner out.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            unlocked = true
            return
        }
        authenticating = true
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Muse Watch") { success, _ in
            DispatchQueue.main.async {
                authenticating = false
                withAnimation { unlocked = success }
                failed = !success
            }
        }
    }
}

private struct LockCover: View {
    let showUnlock: Bool
    let failed: Bool
    let unlock: () -> Void

    var body: some View {
        ZStack {
            Theme.navy.ignoresSafeArea()
            VStack(spacing: 20) {
                AvatarView(image: AvatarStore.load(), size: 96)
                Text("Muse Watch").font(.title2.bold()).foregroundStyle(.white)
                if showUnlock {
                    Button(action: unlock) {
                        Label("Unlock", systemImage: "faceid")
                            .padding(.horizontal, 24).padding(.vertical, 10)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.blue)
                    if failed {
                        Text("Not unlocked. Try again.").font(.footnote).foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
        }
    }
}
