import Foundation

/// Which OpenAI-compatible endpoint shape the provider speaks.
enum APIMode: String, Codable, CaseIterable, Identifiable {
    case chatCompletions
    case responses

    var id: String { rawValue }
    var label: String {
        switch self {
        case .chatCompletions: return "Chat Completions"
        case .responses: return "Responses"
        }
    }
    var path: String {
        switch self {
        case .chatCompletions: return "chat/completions"
        case .responses: return "responses"
        }
    }
}

/// Ready-made provider settings. Meta's own Model API was a US-only public preview at
/// launch; OpenRouter serves the same Muse Spark model and accepts Canadian accounts.
enum ProviderPreset: String, CaseIterable, Identifiable {
    case meta
    case openRouter
    case custom

    var id: String { rawValue }
    var label: String {
        switch self {
        case .meta: return "Meta Model API"
        case .openRouter: return "OpenRouter"
        case .custom: return "Custom"
        }
    }
    var baseURL: String? {
        switch self {
        case .meta: return "https://api.meta.ai/v1"
        case .openRouter: return "https://openrouter.ai/api/v1"
        case .custom: return nil
        }
    }
    var model: String? {
        switch self {
        case .meta: return "muse-spark-1.1"
        case .openRouter: return "meta/muse-spark-1.1"
        case .custom: return nil
        }
    }
    var apiMode: APIMode? {
        switch self {
        case .meta: return .responses
        case .openRouter: return .chatCompletions
        case .custom: return nil
        }
    }
}

/// Everything the phone and watch need to reach Muse, minus the API key (that lives in the Keychain).
struct MuseConfig: Codable, Equatable {
    var baseURL: String = ProviderPreset.meta.baseURL!
    var model: String = ProviderPreset.meta.model!
    var apiMode: APIMode = .responses
    var agentName: String = "Muse"
    var systemPrompt: String = """
    You are Muse, Scott Townsend's personal AI agent. Scott runs Inks N Stuff IT / UrFleet \
    (managed print & IT services, Edmonton), GetToner.ca (toner & ink e-commerce) and Townsend \
    Estates & Trust. Be direct: bottom line first, then detail. Use Canadian spelling and \
    Alberta/Canadian context by default.
    """
    var maxOutputTokens: Int = 800
    var watchMaxOutputTokens: Int = 300
    var quickPrompts: [String] = [
        "Give me a 3-line pitch for UrFleet managed print",
        "Draft a short follow-up text to a prospect",
        "What should I focus on next?",
        "Best reply to a prospect who says we are too expensive?"
    ]
    var autoSpeakOnWatch: Bool = true

    /// Added to the system prompt for requests made from the wrist.
    static let watchStyleHint = "The user is on an Apple Watch. Reply in 1–3 short sentences, no markdown, no lists unless asked."

    var endpointURL: URL? {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var url = URL(string: trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed),
              url.scheme?.lowercased() == "https", url.host() != nil,
              url.user == nil, url.password == nil else { return nil } // HTTPS only, no embedded credentials
        url.append(path: apiMode.path)
        return url
    }

    mutating func apply(_ preset: ProviderPreset) {
        if let v = preset.baseURL { baseURL = v }
        if let v = preset.model { model = v }
        if let v = preset.apiMode { apiMode = v }
    }

    var matchingPreset: ProviderPreset {
        ProviderPreset.allCases.first { $0.baseURL == baseURL && $0.model == model } ?? .custom
    }
}

/// Persists the config in UserDefaults on each device.
enum ConfigStore {
    private static let key = "muse.config"

    static func load() -> MuseConfig {
        guard let data = UserDefaults.standard.data(forKey: key),
              let config = try? JSONDecoder().decode(MuseConfig.self, from: data) else {
            return MuseConfig()
        }
        return config
    }

    static func save(_ config: MuseConfig) {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}
