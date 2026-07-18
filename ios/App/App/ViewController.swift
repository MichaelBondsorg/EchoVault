import Capacitor

final class ViewController: CAPBridgeViewController {
    private let pendingCaptureModeKey = "engram.pendingCaptureMode"

    override func viewDidLoad() {
        super.viewDidLoad()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(openPendingCapture),
            name: .engramOpenPendingCapture,
            object: nil
        )
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CapturePlugin())
        openPendingCapture()
    }

    @objc func openPendingCapture() {
        guard let mode = UserDefaults.standard.string(forKey: pendingCaptureModeKey) else { return }
        let safeMode = mode == "voice" ? "voice" : "text"
        let script = "window.dispatchEvent(new CustomEvent('engram:open-entry',{detail:{mode:'\(safeMode)'}}));"
        bridge?.webView?.evaluateJavaScript(script) { _, error in
            if error == nil { UserDefaults.standard.removeObject(forKey: self.pendingCaptureModeKey) }
        }
    }
}

extension Notification.Name {
    static let engramOpenPendingCapture = Notification.Name("engram.openPendingCapture")
}
