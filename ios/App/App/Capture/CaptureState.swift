import Foundation

struct CaptureDraft: Codable {
    enum Status: String, Codable { case recording, stored, interrupted, needsReview }

    let id: String
    let ownerHash: String
    let fileName: String
    let mime: String
    let createdAt: Date
    var durationMilliseconds: Int
    var status: Status
}
