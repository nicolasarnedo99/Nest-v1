# iPhone 17e transaction automation investigation

Checked 12 September 2026. Research delegated execution was unavailable because the agent-thread limit was reached; primary-source review was completed directly.

## Findings

Apple documents Transaction as a personal automation trigger, with a selected Wallet card triggering when tapped. It is not an action to find in the shortcut editor's Search Actions field. [Transaction trigger](https://support.apple.com/en-az/guide/shortcuts/apd65c67538a/ios).

Apple's creation flow begins in the Automation tab, adding a personal automation and choosing its trigger before adding actions. On subsequent inspection, the 11:08:00 screenshot shows the correct Personal Automation picker, including Message followed by Airplane Mode with no visible Transaction entry. The 11:08:51 screenshot shows the Automation tab. The earlier wrong-screen diagnosis was based on incomplete screenshot review and is withdrawn. The screenshot does not show the entire scrollable list. [Create a personal automation](https://support.apple.com/guide/shortcuts/create-a-new-personal-automation-apdfbdbd7123/9.0/ios).

iPhone 17e specifications include Apple Pay and NFC with reader mode. The reviewed documentation does not identify an iPhone 17e exclusion for Transaction automations. Hardware support alone does not prove that the trigger appears on this particular software installation. [Device specifications](https://www.apple.com/iphone-17e/specs/).

The reviewed trigger documentation does not establish specific Revolut/Mastercard field delivery, merchant/amount availability, or a region-based explanation for a missing trigger. Do not claim these are verified. A tap is not settlement confirmation.

## Next diagnostic

The user has already reached the correct picker. Do not repeat navigation instructions as a diagnosis. Searching Transaction in this picker's Search field can establish whether it appears elsewhere in the list.

The picker screenshot is already supplied. Remaining information: exact iOS version from Settings > General > About and whether the Revolut card is provisioned in Apple Wallet on this phone. Do not reset settings, change regions, or delete cards based on speculation. No device-specific cause has yet been proven.
