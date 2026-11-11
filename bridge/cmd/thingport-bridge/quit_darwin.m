#import <Cocoa/Cocoa.h>
#include <signal.h>
#include <unistd.h>

static int countRunning(NSArray<NSRunningApplication *> *apps) {
    int running = 0;
    for (NSRunningApplication *app in apps) {
        if (kill(app.processIdentifier, 0) == 0) {
            running++;
        }
    }
    return running;
}

static int waitForExit(NSArray<NSRunningApplication *> *apps, double seconds) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
    int running = countRunning(apps);
    while (running > 0 && [deadline timeIntervalSinceNow] > 0) {
        usleep(100000);
        running = countRunning(apps);
    }
    return running;
}

// Quits every other running Bridge so the next link starts the one just installed. One that's
// still downloading a file gets graceSeconds to finish it. Returns how many are left running.
int TPQuitOtherBridges(const char *bundleID, double graceSeconds) {
    @autoreleasepool {
        NSString *bid = [NSString stringWithUTF8String:bundleID];
        pid_t me = getpid();
        NSMutableArray<NSRunningApplication *> *others = [NSMutableArray array];
        for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:bid]) {
            if (app.processIdentifier != me) {
                [others addObject:app];
                [app terminate];
            }
        }
        if (waitForExit(others, graceSeconds) == 0) {
            return 0;
        }
        for (NSRunningApplication *app in others) {
            [app forceTerminate];
        }
        return waitForExit(others, 2);
    }
}
