export interface WatchtowerConfiguration {
    shutdownDelay?: number;
    gracefulShutdownTimeoutPeriod?: number;
    shutdownHandlerTimeoutPeriod?: number;
    healthCheckTimeoutPeriod?: number;
    signals?: readonly string[];
}

export type BlockingTask = Promise<never>;
export type HealthCheckHandler = () => Promise<void> | void;

export type BeaconContext = Record<string, unknown>;

export interface BeaconController {
    die: () => Promise<void>;
}

export interface Beacon {
    context: BeaconContext;
}

export type ShutdownHandler = () => Promise<void> | void

export interface ConnectionManager {
    pause?: () => Promise<void> | void
    resume?: () => Promise<void> | void
    /**
     * Initiates graceful termination of the server.
     */
    close: ShutdownHandler
}

export type HttpServerManagerConfiguration = {
    closeActiveConnectionsTimeoutPeriod?: number
};