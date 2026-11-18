internal import ExpoAppIntents
internal import ExpoModulesCore
import UserNotifications

/// Registered Expo inline module that wires app-target App Intents code to expo-app-intents.
/// Do not change the name of this class.
final class AppIntentsSetup: Module {
  public func definition() -> ExpoModulesCore.ModuleDefinition {
    Name("AppIntentsSetup")

    // Created as the foreground app starts. iOS asks the owner only the first time,
    // so "Note Payment" can later post its notification from the background.
    OnCreate {
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }
  }
}
