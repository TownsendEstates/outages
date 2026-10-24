import SwiftUI
import UIKit

/// Muse's avatar image. Picked on the iPhone, resized and re-encoded (which strips EXIF/GPS),
/// then synced to the watch. On the watch it lives in the App Group so the complication can show it too.
enum AvatarStore {
    static let appGroup = "group.ca.townsendestates.musewatch"
    static let maxPixels: CGFloat = 256

    private static var fileURL: URL {
        let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appending(path: "avatar.jpg")
    }

    static func load() -> UIImage? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return UIImage(data: data)
    }

    static func loadData() -> Data? {
        try? Data(contentsOf: fileURL)
    }

    /// Saves already-normalized JPEG data, or removes the avatar when `data` is nil/empty.
    static func save(_ data: Data?) {
        guard let data, !data.isEmpty, UIImage(data: data) != nil else {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        // Readable while locked so the complication can render on the watch face.
        try? data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    #if os(iOS)
    /// Center-crops to a square, scales to 256 px and re-encodes as JPEG (drops all metadata).
    static func normalize(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let side = min(image.size.width, image.size.height)
        let crop = CGRect(x: (image.size.width - side) / 2, y: (image.size.height - side) / 2, width: side, height: side)
        let target = CGSize(width: maxPixels, height: maxPixels)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            let scale = maxPixels / side
            image.draw(in: CGRect(x: -crop.minX * scale, y: -crop.minY * scale,
                                  width: image.size.width * scale, height: image.size.height * scale))
        }
        return rendered.jpegData(compressionQuality: 0.85)
    }
    #endif
}

/// Circular avatar with an optional "thinking" pulse. Falls back to a branded sparkle badge.
struct AvatarView: View {
    var image: UIImage?
    var size: CGFloat
    var thinking = false

    @State private var pulse = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                LinearGradient(colors: [Theme.blue, Theme.navy], startPoint: .topLeading, endPoint: .bottomTrailing)
                Image(systemName: "sparkles")
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(Theme.amber)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay {
            Circle()
                .stroke(Theme.amber, lineWidth: max(1, size * 0.05))
                .scaleEffect(thinking && pulse ? 1.18 : 1)
                .opacity(thinking ? (pulse ? 0.2 : 0.9) : 0.6)
        }
        .onAppear { startPulseIfNeeded() }
        .onChange(of: thinking) { startPulseIfNeeded() }
        .accessibilityLabel("Muse avatar")
    }

    private func startPulseIfNeeded() {
        pulse = false
        guard thinking else { return }
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
    }
}
