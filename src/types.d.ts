export interface WatchtowerConfiguration {
    /**
     * Delay in ms before the shutdown sequence starts.
     *
     * @defaultValue -1 (disabled)
     *
     * @see https://freecontent.manning.com/handling-client-requests-properly-with-kubernetes/
     */
    shutdownDelayMs: number;

    /**
     * Max total shutdown time before process is killed.
     *
     * @defaultValue 10000 (10s)
     */
    shutdownTimeoutMs: number;

    /**
     * Timeout period for shutdown tasks.
     *
     * @defaultValue -1 (disabled)
     */
    shutdownTasksTimeoutMs: number;

    /**
     * Timeout period for health check.
     *
     * @defaultValue 1000 (1s)
     */
    healthCheckTimeoutMs: number;

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

export type StartupTask = Promise<never>;
export type HealthCheckHandler = () => Promise<boolean> | boolean;

export interface Beacon {
    die: () => void;
}

export type ShutdownTask = () => Promise<void> | void