import { EventEmitter } from 'events';
import { clearTimeout } from 'timers';

import { Beacon, BlockingTask, HealthCheckHandler, ShutdownHandler, WatchtowerConfiguration } from './types';

const defaultConfiguration: WatchtowerConfiguration = {
  shutdownDelay: false,
  gracefulShutdownTimeoutPeriod: 30_000,
  shutdownHandlerTimeoutPeriod: 5_000,
  healthCheckTimeoutPeriod: 500,
  terminationSignals: ['SIGTERM', 'SIGINT', 'SIGHUP'],
};

export class Watchtower extends EventEmitter {
  private readonly configuration: WatchtowerConfiguration;

  private _isReady = false;
  private _isHealthy = false;
  private _isShuttingDown = false;

  private resolveReady!: () => void;
  private rejectReady!: (reason?: Error) => void;
  private readonly deferredReady = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });

  private readonly blockingTasks: BlockingTask[] = [];
  private readonly shutdownHandlers: ShutdownHandler[] = [];
  private readonly beacons: Beacon[] = [];
  private readonly healthCheckHandlers: HealthCheckHandler[] = [];

  constructor(userConfiguration?: Partial<WatchtowerConfiguration>) {
    super();

    this.configuration = { ...defaultConfiguration, ...userConfiguration };

    this.registerSignals();

    this.deferredReady
      .then(() => {
        this._isReady = true;
        this.emit('ready');
        this.signalHealthy();
      })
      .catch(async (err) => {
        this.emit('error', new Error('service couldn\'t become ready', { cause: err }));
        this.terminate(1);
      });
  }

  isReady(): boolean {
    return this._isReady;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.isReady() || this.isShuttingDown()) {
      return false;
    }

    this._isHealthy = this._isHealthy && await this.areHealthCheckHandlersPassing();

    return this._isHealthy && this.isReady() && !this.isShuttingDown();
  }

  signalHealthy(): void {
    if (!this.isReady() || this.isShuttingDown()) {
      return;
    }

    this._isHealthy = true;

    this.emit('healthStateChange', this._isHealthy);
  }

  signalUnhealthy(): void {
    if (!this.isReady() || this.isShuttingDown()) {
      return;
    }

    this._isHealthy = false;

    this.emit('healthStateChange', this._isHealthy);
  }

  isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  /**
   * Signals that the service is ready to accept traffic after all blocking tasks have been resolved.
   *
   * This method should be called after all blocking tasks have been queued.
   *
   * - If there are no blocking tasks, the service will become ready immediately.
   * - If there are blocking tasks, the service will become ready after all of them have been resolved.
   * - If the watchtower is already ready or shutting down, this method does nothing.
   *
   * After watchtower becomes ready for the first time, it will emit a 'ready' event.
   */
  async ready(): Promise<void> {
    if (this.isReady() || this.isShuttingDown()) {
      return;
    }

    if (this.blockingTasks.length <= 0) {
      this.resolveReady();
    }

    return this.deferredReady;
  }

  queueBlockingTask(blockingTask: BlockingTask): void {
    if (this.isReady()) {
      throw new Error('cannot queue blocking task after the service has become ready');
    }

    this.blockingTasks.push(blockingTask);

    blockingTask
      .then(() => {
        const index = this.blockingTasks.indexOf(blockingTask);
        this.blockingTasks.splice(index, 1);

        if (!this.isReady() && this.blockingTasks.length <= 0) {
          this.resolveReady();
        }
      })
      .catch((err) => {
        const startupTaskError = new Error('startup task failed', { cause: err });
        this.emit('error', startupTaskError);
        this.rejectReady(startupTaskError);
      });
  }

  public async shutdown(reason?: string): Promise<void> {
    await this.deferredReady;

    if (this.configuration.shutdownDelay) {
      // Adding delay to ensure all the proxies have done their job
      // https://freecontent.manning.com/handling-client-requests-properly-with-kubernetes/
      await new Promise((res) => setTimeout(res, this.configuration.shutdownDelayDuration));
    }

    if (this.isShuttingDown()) {
      return;
    }

    this.signalUnhealthy();
    this._isShuttingDown = true;

    this.emit('shutdown', reason);

    const gracefulShutdownTimeout = setTimeout(() => {
      this.emit('error', new Error('graceful shutdown period ended, forcing process termination'));
      this.terminate(1);
    }, this.configuration.gracefulShutdownTimeoutPeriod).unref();

    await this.awaitBeacons();
    await this.runShutdownHandlers();

    clearTimeout(gracefulShutdownTimeout);

    this.emit('close');

    // After that point process should exit on its own,
    // in case something is keeping the event loop active
    // we will forcefully terminate it after 1s
    setTimeout(() => {
      this.emit('error', new Error('process did not exit on its own, investigate what is keeping the event loop active'));
      this.terminate(1);
    }, 1_000).unref();
  }

  createBeacon(): Beacon {
    if (this.isShuttingDown()) {
      throw new Error('cannot create beacons after the shutdown has started');
    }

    const beacon = {
      die: () => {
        const index = this.beacons.indexOf(beacon);
        this.beacons.splice(index, 1);

        this.emit('beaconKilled', beacon);
      }
    };

    this.beacons.push(beacon);

    return beacon;
  }

  registerHealthCheckHandler(healthCheckHandler: HealthCheckHandler): void {
    this.healthCheckHandlers.push(healthCheckHandler);
  }

  registerShutdownHandler(shutdownHandler: ShutdownHandler): void {
    if (this.isShuttingDown()) {
      throw new Error('cannot register shutdown handler after the shutdown has started');
    }

    this.shutdownHandlers.push(shutdownHandler);
  }

  private async awaitBeacons(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.beacons.length <= 0) {
          // No more live beacons, we can proceed with the shutdown
          this.off('beaconKilled', check);
          resolve();
        }
      };

      this.on('beaconKilled', check);

      check();
    });
  }

  private async runShutdownHandlers(): Promise<void> {
    const shutdownHandlerTimeout = setTimeout(() => {
      this.emit('error', new Error('shutdown handler period ended, forcing process termination'));
      this.terminate(1);
    }, this.configuration.shutdownHandlerTimeoutPeriod).unref();
    
    await Promise.all(this.shutdownHandlers.map((handler) => handler()));

    clearTimeout(shutdownHandlerTimeout);
  }

  private async areHealthCheckHandlersPassing(): Promise<boolean> {
    const healthCheckTimeout = setTimeout(() => {
      this.emit('error', new Error('health check shutdown period ended, service deemed unhealthy'));
      return false;
    }, this.configuration.healthCheckTimeoutPeriod).unref();

    const healthChecks = await Promise.all(this.healthCheckHandlers.map((handler) => handler()));

    clearTimeout(healthCheckTimeout);

    return healthChecks.every((result) => result);
  }

  private registerSignals(): void {
    for (const signal of this.configuration.terminationSignals) {
      process.on(signal, () => {
        void this.shutdown(`process received ${signal} signal`);
      });
    }
  }

  private terminate(code: number): void {
    process.exit(code);
  }
}
