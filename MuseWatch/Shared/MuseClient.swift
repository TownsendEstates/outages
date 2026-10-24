import Foundation

enum MuseError: LocalizedError {
    case missingKey
    case badURL
    case http(Int, String)
    case emptyReply
    case network(String)

    var errorDescription: String? {
        switch self {
        case .missingKey:
            return "No API key. Add it in the iPhone app's Settings."
        case .badURL:
            return "The base URL in Settings isn't valid."
        case .http(401, _):
            return "API key was rejected (401). Check the key in Settings."
        case .http(403, let body):
            return "Access denied (403). Meta's Model API preview may not be open in Canada yet — try the OpenRouter preset. \(body)"
        case .http(404, _):
            return "Endpoint not found (404). Try switching the API mode in Settings."
        case .http(429, _):
            return "Rate limited or out of credits (429). Try again shortly."
        case .http(let code, let body):
            return "Server error \(code). \(body)"
        case .emptyReply:
            return "Muse returned an empty reply."
        case .network(let detail):
            return "Network problem: \(detail)"
        }
    }
}

/// Talks to Muse Spark through any OpenAI-compatible endpoint
/// (Meta Model API, OpenRouter, or a custom gateway).
struct MuseClient {
    var config: MuseConfig
    var apiKey: String?

    init(config: MuseConfig = ConfigStore.load(), apiKey: String? = KeychainStore.apiKey) {
        self.config = config
        self.apiKey = apiKey
    }

    /// Sends the conversation and returns Muse's reply text.
    func send(_ messages: [ChatMessage], fromWatch: Bool) async throws -> String {
        guard let apiKey, !apiKey.isEmpty else { throw MuseError.missingKey }
        guard let url = config.endpointURL else { throw MuseError.badURL }

        var instructions = config.systemPrompt
        if fromWatch { instructions += "\n\n" + MuseConfig.watchStyleHint }
        let maxTokens = fromWatch ? config.watchMaxOutputTokens : config.maxOutputTokens
        let turns: [[String: String]] = messages.map { ["role": $0.role.rawValue, "content": $0.text] }

        let body: [String: Any]
        switch config.apiMode {
        case .chatCompletions:
            body = ["model": config.model,
                    "messages": [["role": "system", "content": instructions]] + turns,
                    "max_tokens": maxTokens]
        case .responses:
            body = ["model": config.model,
                    "instructions": instructions,
                    "input": turns,
                    "max_output_tokens": maxTokens]
        }

        var request = URLRequest(url: url, timeoutInterval: fromWatch ? 45 : 90)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // OpenRouter uses these to label usage on its dashboard; other providers ignore them.
        request.setValue("Muse Watch", forHTTPHeaderField: "X-Title")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw MuseError.network(error.localizedDescription)
        }

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MuseError.http(http.statusCode, Self.errorMessage(from: data))
        }

        guard let text = Self.replyText(from: data, mode: config.apiMode)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            throw MuseError.emptyReply
        }
        return text
    }

    /// Quick connectivity check used by Settings. Tries the configured mode, then the other one,
    /// and reports which worked so the user can switch.
    func testConnection() async -> Result<APIMode, Error> {
        let probe = [ChatMessage(role: .user, text: "Reply with the single word: ready")]
        var lastError: Error = MuseError.emptyReply
        for mode in [config.apiMode] + APIMode.allCases.filter({ $0 != config.apiMode }) {
            var client = self
            client.config.apiMode = mode
            client.config.watchMaxOutputTokens = 16
            do {
                _ = try await client.send(probe, fromWatch: true)
                return .success(mode)
            } catch MuseError.http(let code, let body) where code == 404 || code == 400 {
                lastError = MuseError.http(code, body)
                continue
            } catch {
                return .failure(error)
            }
        }
        return .failure(lastError)
    }

    // MARK: - Parsing

    static func replyText(from data: Data, mode: APIMode) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }

        // Chat Completions: choices[0].message.content
        if let choices = json["choices"] as? [[String: Any]],
           let message = choices.first?["message"] as? [String: Any] {
            if let content = message["content"] as? String { return content }
            if let parts = message["content"] as? [[String: Any]] {
                return parts.compactMap { $0["text"] as? String }.joined()
            }
        }

        // Responses: output_text shortcut, or output[].content[].text
        if let text = json["output_text"] as? String { return text }
        if let output = json["output"] as? [[String: Any]] {
            let texts = output
                .filter { ($0["type"] as? String) == "message" || $0["content"] != nil }
                .flatMap { ($0["content"] as? [[String: Any]]) ?? [] }
                .filter { ($0["type"] as? String).map { $0 == "output_text" || $0 == "text" } ?? true }
                .compactMap { $0["text"] as? String }
            if !texts.isEmpty { return texts.joined(separator: "\n") }
        }
        return nil
    }

    static func errorMessage(from data: Data) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let error = json["error"] as? [String: Any], let message = error["message"] as? String { return message }
            if let message = json["error"] as? String { return message }
            if let message = json["message"] as? String { return message }
        }
        return String(data: data.prefix(200), encoding: .utf8) ?? ""
    }
}
