import Foundation
import Security

/// Minimal Keychain wrapper for the Muse API key. Each device keeps its own copy;
/// the phone pushes it to the watch over WatchConnectivity (end-to-end encrypted by Apple).
enum KeychainStore {
    private static let service = "ca.townsendestates.musewatch"
    private static let account = "muse.apiKey"

    static var apiKey: String? {
        get { read() }
        set {
            if let newValue, !newValue.isEmpty { write(newValue) } else { delete() }
        }
    }

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private static func read() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func write(_ value: String) {
        let data = Data(value.utf8)
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        if SecItemUpdate(baseQuery as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            var add = baseQuery
            add.merge(attrs) { $1 }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    private static func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
