// Records one window of a process with ScreenCaptureKit, even while other
// windows cover it, until SIGINT or SIGTERM.
//
//   wincap <pid> <out.mov> <start-file>
//
// Writes ProRes 4444 at the window's pixel size, at most 30 frames a second
// (ScreenCaptureKit sends a frame only when the window changes), and writes
// the wall-clock time of the first frame to <start-file>.
import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

// A command-line tool has no window-server connection until something asks for
// one; ScreenCaptureKit asserts without it.
_ = NSApplication.shared
_ = CGMainDisplayID()

let arguments = CommandLine.arguments
guard arguments.count == 4, let pid = pid_t(arguments[1]) else {
    FileHandle.standardError.write(Data("usage: wincap <pid> <out.mov> <start-file>\n".utf8))
    exit(2)
}
let outURL = URL(fileURLWithPath: arguments[2])
let startFile = arguments[3]

final class Recorder: NSObject, SCStreamOutput {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    private var started = false

    init(url: URL, width: Int, height: Int) throws {
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.proRes4444,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        input.expectsMediaDataInRealTime = true
        writer.add(input)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, buffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: raw) == .complete
        else { return }
        if !started {
            writer.startWriting()
            writer.startSession(atSourceTime: buffer.presentationTimeStamp)
            started = true
            try? "\(Date().timeIntervalSince1970)\n".write(toFile: startFile, atomically: true, encoding: .utf8)
        }
        if input.isReadyForMoreMediaData { input.append(buffer) }
    }
}

// The process's window, once it is on screen (up to ten seconds).
var target: SCWindow?
for _ in 0..<50 {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    target = content.windows.first { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 100 }
    if target != nil { break }
    try await Task.sleep(nanoseconds: 200_000_000)
}
guard let window = target else {
    FileHandle.standardError.write(Data("wincap: no window for pid \(pid)\n".utf8))
    exit(1)
}

let filter = SCContentFilter(desktopIndependentWindow: window)
let scale = Int(filter.pointPixelScale)
let config = SCStreamConfiguration()
config.width = Int(window.frame.width) * scale
config.height = Int(window.frame.height) * scale
config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
config.showsCursor = false
config.pixelFormat = kCVPixelFormatType_32BGRA
config.ignoreShadowsSingleWindow = true

let recorder = try Recorder(url: outURL, width: config.width, height: config.height)
let stream = SCStream(filter: filter, configuration: config, delegate: nil)
try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: DispatchQueue(label: "wincap"))
try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
    stream.startCapture { error in if let error { done.resume(throwing: error) } else { done.resume() } }
}
print("wincap: \(config.width)x\(config.height) px")

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let stop = DispatchSemaphore(value: 0)
let sources = [SIGINT, SIGTERM].map { number -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: number)
    source.setEventHandler { stop.signal() }
    source.resume()
    return source
}
await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
    DispatchQueue.global().async {
        stop.wait()
        done.resume()
    }
}
_ = sources
try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
    stream.stopCapture { error in if let error { done.resume(throwing: error) } else { done.resume() } }
}
recorder.input.markAsFinished()
await recorder.writer.finishWriting()
