import AppIntents
import UserNotifications
internal import ExpoAppIntents

/// Run by a Shortcuts "Transaction" automation after an Apple Pay tap. It only queues the
/// merchant and amount and posts a local notification; the model, wallet and network run
/// later, in the foreground app, when the owner opens Turtle.
struct NotePaymentIntent: AppIntent {
  static let title: LocalizedStringResource = "Note Payment"
  static let description = IntentDescription("Queues a card payment for Nest to decide the next time it opens.")

  // Runs in the app process without bringing Turtle to the screen (iOS 26+; earlier
  // systems get the same from the default openAppWhenRun = false).
  @available(iOS 26.0, *)
  static let supportedModes: IntentModes = .background

  // Runs while locked: it only queues a tap and notifies; money moves only after the owner opens the app.
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Merchant")
  var merchant: String

  @Parameter(title: "Amount")
  var amount: String

  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(
      name: "notePayment",
      params: ["merchant": .string(merchant), "amount": .string(amount)]
    )
    let content = UNMutableNotificationContent()
    content.title = "Nest"
    content.body = "\(merchant) · \(amount): open Nest to decide"
    try await UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    return .result()
  }
}
