import Capacitor
import Foundation

@objc(CapturePlugin)
public final class CapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapturePlugin"
    public let jsName = "Capture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDrafts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readDraft", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteDraft", returnType: CAPPluginReturnPromise),
    ]

    @objc func requestPermission(_ call: CAPPluginCall) {
        CaptureCoordinator.shared.requestPermission { granted in
            DispatchQueue.main.async { call.resolve(["granted": granted]) }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), !ownerUid.isEmpty else {
            call.reject("owner_required")
            return
        }
        do {
            let draft = try CaptureCoordinator.shared.start(ownerUid: ownerUid)
            call.resolve([
                "draftId": draft.id,
                "startedAt": ISO8601DateFormatter().string(from: draft.createdAt),
            ])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), let draftId = call.getString("draftId") else {
            call.reject("capture_arguments_required")
            return
        }
        do {
            let (draft, data) = try CaptureCoordinator.shared.stop(ownerUid: ownerUid, draftId: draftId)
            call.resolve([
                "draftId": draft.id,
                "assetId": draft.id,
                "mime": draft.mime,
                "durationMs": draft.durationMilliseconds,
                "base64": data.base64EncodedString(),
            ])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func listDrafts(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid") else {
            call.reject("owner_required")
            return
        }
        do {
            let drafts = try CaptureCoordinator.shared.drafts(ownerUid: ownerUid).map { draft in
                [
                    "draftId": draft.id,
                    "createdAt": ISO8601DateFormatter().string(from: draft.createdAt),
                    "durationMs": draft.durationMilliseconds,
                    "status": draft.status.rawValue,
                ] as [String: Any]
            }
            call.resolve(["drafts": drafts])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func readDraft(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), let draftId = call.getString("draftId") else {
            call.reject("capture_arguments_required")
            return
        }
        do {
            let (draft, data) = try CaptureCoordinator.shared.read(ownerUid: ownerUid, draftId: draftId)
            call.resolve([
                "draftId": draft.id,
                "assetId": draft.id,
                "mime": draft.mime,
                "durationMs": draft.durationMilliseconds,
                "base64": data.base64EncodedString(),
            ])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func deleteDraft(_ call: CAPPluginCall) {
        guard let ownerUid = call.getString("ownerUid"), let draftId = call.getString("draftId") else {
            call.reject("capture_arguments_required")
            return
        }
        do {
            try CaptureCoordinator.shared.delete(ownerUid: ownerUid, draftId: draftId)
            call.resolve()
        } catch { call.reject(error.localizedDescription) }
    }
}
