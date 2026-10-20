type PollingTask = () => Promise<unknown> | unknown;

/**
 * Runs a polling task serially. The delay starts after the previous invocation
 * completes, so a slow request can never overlap with the next one.
 */
export const startPolling = (
    task: PollingTask,
    intervalMs: number,
    runImmediately = false,
) => {
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
        try {
            await task();
        } catch (error) {
            console.error("Polling task failed.", error);
        } finally {
            if (!stopped) {
                timeout = setTimeout(run, intervalMs);
            }
        }
    };

    if (runImmediately) {
        void run();
    } else {
        timeout = setTimeout(run, intervalMs);
    }

    return () => {
        stopped = true;
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    };
};
