import PhotosUI
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var sync: WatchSync
    @Environment(ConversationStore.self) private var store
    @AppStorage("security.requireUnlock") private var requireUnlock = true
    @State private var config = ConfigStore.load()
    /// Only holds a key the user is typing. The saved key is never loaded back into the UI.
    @State private var newKey = ""
    @State private var savedKeyHint = Self.keyHint()
    @State private var preset = ConfigStore.load().matchingPreset
    @State private var testStatus: String?
    @State private var isTesting = false
    @State private var newPrompt = ""
    @State private var confirmClear = false
    @State private var confirmRemoveKey = false
    @State private var avatarItem: PhotosPickerItem?
    @State private var avatar = AvatarStore.load()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 16) {
                        AvatarView(image: avatar, size: 72)
                        VStack(alignment: .leading, spacing: 8) {
                            PhotosPicker(avatar == nil ? "Choose avatar" : "Change avatar",
                                         selection: $avatarItem, matching: .images)
                            if avatar != nil {
                                Button("Remove", role: .destructive) { setAvatar(nil) }
                            }
                        }
                    }
                    TextField("Name", text: $config.agentName)
                    TextField("Instructions", text: $config.systemPrompt, axis: .vertical)
                        .lineLimit(4...12)
                    Stepper("iPhone reply length: \(config.maxOutputTokens) tokens",
                            value: $config.maxOutputTokens, in: 100...4000, step: 100)
                } header: {
                    Text("Agent")
                } footer: {
                    Text("The avatar shows on your watch, in replies and on the watch-face complication. It's cropped to a square and re-saved at 256 px, which strips location and camera data.")
                }

                Section {
                    Picker("Provider", selection: $preset) {
                        ForEach(ProviderPreset.allCases) { Text($0.label).tag($0) }
                    }
                    .onChange(of: preset) { _, new in config.apply(new) }
                    if let savedKeyHint {
                        LabeledContent("Saved key", value: savedKeyHint)
                    }
                    SecureField(savedKeyHint == nil ? "API key" : "Replace API key", text: $newKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.password)
                    TextField("Base URL (https://…)", text: $config.baseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Model", text: $config.model)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Picker("API mode", selection: $config.apiMode) {
                        ForEach(APIMode.allCases) { Text($0.label).tag($0) }
                    }
                    Button {
                        Task { await test() }
                    } label: {
                        HStack {
                            Text("Test connection")
                            if isTesting { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(isTesting || (savedKeyHint == nil && newKey.isEmpty))
                    if let testStatus { Text(testStatus).font(.footnote).foregroundStyle(.secondary) }
                    if savedKeyHint != nil {
                        Button("Remove API key", role: .destructive) { confirmRemoveKey = true }
                    }
                } header: {
                    Text("Muse connection")
                } footer: {
                    Text("Get a Meta Model API key from Meta's developer portal. If Meta returns 403 from Canada, use the OpenRouter preset with an OpenRouter key — it's the same Muse Spark model. Use a key that's only for this app, so you can revoke it without affecting anything else.")
                }

                Section {
                    Toggle("Read replies aloud on Watch", isOn: $config.autoSpeakOnWatch)
                    Stepper("Watch reply length: \(config.watchMaxOutputTokens) tokens",
                            value: $config.watchMaxOutputTokens, in: 50...1000, step: 50)
                    ForEach(config.quickPrompts, id: \.self) { Text($0) }
                        .onDelete { config.quickPrompts.remove(atOffsets: $0) }
                        .onMove { config.quickPrompts.move(fromOffsets: $0, toOffset: $1) }
                    HStack {
                        TextField("Add quick prompt", text: $newPrompt)
                        Button("Add") {
                            config.quickPrompts.append(newPrompt.trimmingCharacters(in: .whitespaces))
                            newPrompt = ""
                        }
                        .disabled(newPrompt.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("Apple Watch")
                } footer: {
                    Text(watchStatus)
                }

                Section {
                    Toggle("Require Face ID to open", isOn: $requireUnlock)
                    Button("Clear iPhone history", role: .destructive) { confirmClear = true }
                } header: {
                    Text("Security & privacy")
                } footer: {
                    Text("Prompts go to the provider above, which processes them on US servers. Don't dictate client personal information — PIPA/PIPEDA cross-border rules apply. Chat history stays on this iPhone and your watch only: it's encrypted while the phone is locked and left out of backups.")
                }

                Section {
                    Button("Save & sync to Watch") { save() }
                        .bold()
                }
            }
            .navigationTitle("Settings")
            .toolbar { EditButton() }
            .onDisappear { save() }
            .onChange(of: avatarItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let normalized = AvatarStore.normalize(data) {
                        setAvatar(normalized)
                    }
                    avatarItem = nil
                }
            }
            .confirmationDialog("Delete all conversations on this iPhone?", isPresented: $confirmClear) {
                Button("Delete all", role: .destructive) { store.deleteAll() }
            }
            .confirmationDialog("Remove the API key from this iPhone and your watch?", isPresented: $confirmRemoveKey) {
                Button("Remove key", role: .destructive) {
                    KeychainStore.apiKey = nil
                    savedKeyHint = nil
                    sync.pushToWatch()
                }
            }
        }
    }

    private var watchStatus: String {
        guard sync.isPaired else { return "No Apple Watch paired." }
        guard sync.isWatchAppInstalled else { return "Install Muse on your watch from the Watch app on iPhone." }
        var status = sync.isReachable ? "Watch connected." : "Watch not reachable right now — settings will sync when it is."
        if let last = sync.lastSync { status += " Last sync \(last.formatted(date: .omitted, time: .shortened))." }
        return status
    }

    /// "••••abcd" for a saved key, so it can be identified without being shown.
    private static func keyHint() -> String? {
        guard let key = KeychainStore.apiKey, !key.isEmpty else { return nil }
        return "••••" + key.suffix(4)
    }

    private func setAvatar(_ data: Data?) {
        AvatarStore.save(data)
        avatar = AvatarStore.load()
        sync.pushToWatch()
    }

    private func save() {
        ConfigStore.save(config)
        let typed = newKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            KeychainStore.apiKey = typed
            newKey = ""
            savedKeyHint = Self.keyHint()
        }
        sync.pushToWatch()
    }

    private func test() async {
        save()
        isTesting = true
        testStatus = nil
        defer { isTesting = false }
        if config.endpointURL == nil {
            testStatus = MuseError.badURL.localizedDescription
            return
        }
        switch await MuseClient(config: config, apiKey: KeychainStore.apiKey).testConnection() {
        case .success(let mode):
            if mode != config.apiMode {
                config.apiMode = mode
                save()
                testStatus = "Connected. Switched API mode to \(mode.label)."
            } else {
                testStatus = "Connected to \(config.model)."
            }
        case .failure(let error):
            testStatus = error.localizedDescription
        }
    }
}
