import Foundation

/// Voice Chapters (flag: voiceChapters) — a single chapter-mark timestamp,
/// relative to the start of the recording. Written to the sidecar JSON
/// atomically at tap time (see CaptureDraftStore.addMarker) so it survives
/// backgrounding/interruption the same way the rest of the draft does.
struct Marker: Codable {
    let tMs: Int
}

struct CaptureDraft: Codable {
    enum Status: String, Codable { case recording, stored, interrupted, needsReview }

    let id: String
    let ownerHash: String
    let fileName: String
    let mime: String
    let createdAt: Date
    var durationMilliseconds: Int
    var status: Status
    // Optional and additive: absent (nil) for every draft recorded before
    // this feature, and for any recording with no chapters tapped — decodes
    // fine against older sidecar JSON that has no "markers" key at all.
    var markers: [Marker]?
}
