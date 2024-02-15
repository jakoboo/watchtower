export interface WatchtowerConfiguration {
    /**
     * Enable delay before the shutdown sequence starts.
     *
     * @defaultValue false
     *
     * @see shutdownDelayDuration
     */
    shutdownDelay: boolean;

    /**
     * Delay before the shutdown sequence starts.
     *
     * @see https://freecontent.manning.com/handling-client-requests-properly-with-kubernetes/
     */
    shutdownDelayDuration?: number;

    /**
     * Max total time before process is killed (if graceful shutdown fails).
     *
     * @defaultValue 30000
     */
    gracefulShutdownTimeoutPeriod: number;

    /**
     * Timeout period for shutdown handlers.
     *
     * @defaultValue 5000
     */
    shutdownHandlerTimeoutPeriod: number;

    /**
     * Timeout period for health check.
     *
     * @defaultValue 500
     */
    healthCheckTimeoutPeriod: number;

    /**
     * List of signals that should trigger graceful shutdown of the server.
     *
     * @remarks It uses `process.on` to listen for signals.
     *
     * @defaultValue [
     *   'SIGTERM',
     *   'SIGINT',
     *   'SIGHUP'
     * ]
     *
     * @see https://nodejs.org/api/process.html#signal-events
     */
    terminationSignals: readonly string[];
}

export type BlockingTask = Promise<never>;
export type HealthCheckHandler = () => Promise<boolean> | boolean;

export interface Beacon {
    die: () => void;
}

export type ShutdownHandler = () => Promise<void> | void