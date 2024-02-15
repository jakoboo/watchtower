import { EventEmitter } from 'events';
import { clearTimeout } from 'timers';

import { Beacon, StartupTask, HealthCheckHandler, ShutdownTask, WatchtowerConfiguration } from './types';

const defaultConfiguration: WatchtowerConfiguration = {
  shutdownDelayMs: -1,
  shutdownTimeoutMs: 10_000,
  shutdownTasksTimeoutMs: -1,
  healthCheckTimeoutMs: 1_000,
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

  private readonly startupTasks: StartupTask[] = [];
  private readonly shutdownTasks: ShutdownTask[] = [];
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
   * Signals that the service is ready to accept traffic after all startup tasks have been resolved.
   *
   * This method should be called after all startup tasks have been queued.
   *
   * - If there are no startup tasks, the service will become ready immediately.
   * - If there are startup tasks, the service will become ready after all of them have been resolved.
   * - If the watchtower is already ready or shutting down, this method does nothing.
   *
   * After watchtower becomes ready for the first time, it will emit a 'ready' event.
   */
  async ready(): Promise<void> {
    if (this.isReady() || this.isShuttingDown()) {
      return;
    }

    if (this.startupTasks.length <= 0) {
      this.resolveReady();
    }

    return this.deferredReady;
  }

  queueStartupTask(startupTask: StartupTask): void {
    if (this.isReady()) {
      throw new Error('cannot queue startup task after the service has become ready');
    }

    this.startupTasks.push(startupTask);

    startupTask
      .then(() => {
        const index = this.startupTasks.indexOf(startupTask);
        this.startupTasks.splice(index, 1);

        if (!this.isReady() && this.startupTasks.length <= 0) {
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

    if (this.configuration.shutdownDelayMs >= 0) {
      // Adding delay to ensure all the proxies have done their job
      // https://freecontent.manning.com/handling-client-requests-properly-with-kubernetes/
      await new Promise((res) => setTimeout(res, this.configuration.shutdownDelayMs));
    }

    if (this.isShuttingDown()) {
      return;
    }

    this.signalUnhealthy();
    this._isShuttingDown = true;

    this.emit('shutdown', reason);

    let gracefulShutdownTimeout;
    if (this.configuration.shutdownTimeoutMs >= 0) {
      gracefulShutdownTimeout = setTimeout(() => {
        this.emit('error', new Error('graceful shutdown period ended, forcing process termination'));
        this.terminate(1);
      }, this.configuration.shutdownTimeoutMs).unref();
    }

    await this.awaitBeacons();
    await this.executeShutdownTasks();

    if (gracefulShutdownTimeout) {
      clearTimeout(gracefulShutdownTimeout);
    }

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

  registerShutdownTask(shutdownTask: ShutdownTask): void {
    if (this.isShuttingDown()) {
      throw new Error('cannot register shutdown task after the shutdown has started');
    }

    this.shutdownTasks.push(shutdownTask);
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

  private async executeShutdownTasks(): Promise<void> {
    let shutdownTasksTimeout;
    if (this.configuration.shutdownTasksTimeoutMs >= 0) {
      shutdownTasksTimeout = setTimeout(() => {
        this.emit('error', new Error('shutdown tasks timeout, forcing process termination'));
        this.terminate(1);
      }, this.configuration.shutdownTasksTimeoutMs).unref();
    }
    
    await Promise.all(this.shutdownTasks.map((task) => task()));

    if (shutdownTasksTimeout) {
      clearTimeout(shutdownTasksTimeout);
    }
  }

  private async areHealthCheckHandlersPassing(): Promise<boolean> {
    let healthCheckTimeout;
    if (this.configuration.healthCheckTimeoutMs >= 0) {
      healthCheckTimeout = setTimeout(() => {
        this.emit('error', new Error('health check timeout, service deemed unhealthy'));
        return false;
      }, this.configuration.healthCheckTimeoutMs).unref();
    }

    const healthChecks = await Promise.all(this.healthCheckHandlers.map((handler) => handler()));

    if (healthCheckTimeout) {
      clearTimeout(healthCheckTimeout);
    }

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
