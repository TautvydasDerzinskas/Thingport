#import <Cocoa/Cocoa.h>

// Shows why a link didn't open. Returns 2 for Open Settings, 1 for Try Again and 0 for Close, as choice does.
int TPAskAboutFailure(const char *title, const char *text, int offerSettings) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        // Run from a terminal, the Bridge isn't an app yet, and one that isn't can't show a dialog.
        if (app.activationPolicy == NSApplicationActivationPolicyProhibited) {
            [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        }
        // The browser is in front, and a background app's dialog would open behind it.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        [app activateIgnoringOtherApps:YES];
#pragma clang diagnostic pop

        NSAlert *alert = [[NSAlert alloc] init];
        alert.alertStyle = NSAlertStyleWarning;
        alert.messageText = [NSString stringWithUTF8String:title];
        alert.informativeText = [NSString stringWithUTF8String:text];
        if (offerSettings) {
            [alert addButtonWithTitle:@"Open Settings"];
        }
        [alert addButtonWithTitle:@"Try Again"];
        [alert addButtonWithTitle:@"Close"];
        alert.buttons.lastObject.keyEquivalent = @"\033";
        [alert.window setLevel:NSFloatingWindowLevel];

        NSInteger index = [alert runModal] - NSAlertFirstButtonReturn;
        if (offerSettings) {
            index--;
            if (index < 0) {
                return 2;
            }
        }
        return index == 0 ? 1 : 0;
    }
}
