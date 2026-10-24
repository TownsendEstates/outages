import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var sync: WatchSync
    @Environment(ConversationStore.self) private var store
    @State private var config = ConfigStore.load()
    @State private var apiKey = KeychainStore.apiKey ?? ""
    @State private var preset = ConfigStore.load().matchingPreset
    @State private var testStatus: String?
    @State private var isTesting = false
    @State private var newPrompt = ""
    @State private var confirmClear = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Provider", selection: $preset) {
                        ForEach(ProviderPreset.allCases) { Text($0.label).tag($0) }
                    }
                    .onChange(of: preset) { _, new in config.apply(new) }
                    SecureField("API key", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Base URL", text: $config.baseURL)
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
                    .disabled(isTesting || apiKey.isEmpty)
                    if let testStatus { Text(testStatus).font(.footnote).foregroundStyle(.secondary) }
                } header: {
                    Text("Muse connection")
                } footer: {
                    Text("Meta Model API keys come from Meta's developer portal. If Meta returns 403 from Canada, use the OpenRouter preset with an OpenRouter key — same Muse Spark model.")
                }

                Section("Agent") {
                    TextField("Name", text: $config.agentName)
                    TextField("Instructions", text: $config.systemPrompt, axis: .vertical)
                        .lineLimit(4...12)
                    Stepper("iPhone reply length: \(config.maxOutputTokens) tokens",
                            value: $config.maxOutputTokens, in: 100...4000, step: 100)
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
                    Button("Save & sync to Watch") { save() }
                        .bold()
                    Button("Clear iPhone history", role: .destructive) { confirmClear = true }
                }

                Section("Privacy") {
                    Text("Prompts are sent to the provider above (servers in the US). Avoid dictating client personal information — PIPA/PIPEDA cross-border rules apply. History is stored only on this device and your watch.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar { EditButton() }
            .onDisappear { save() }
            .confirmationDialog("Delete all conversations on this iPhone?", isPresented: $confirmClear) {
                Button("Delete all", role: .destructive) { store.deleteAll() }
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

    private func save() {
        ConfigStore.save(config)
        KeychainStore.apiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        sync.pushToWatch()
    }

    private func test() async {
        save()
        isTesting = true
        testStatus = nil
        defer { isTesting = false }
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
