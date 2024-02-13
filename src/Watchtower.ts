import util from 'util';
import { EventEmitter } from 'events';
import { clearTimeout } from 'timers';

import { Gauge } from 'prom-client';
import type { Beacon, BeaconContext, BeaconController, BlockingTask, HealthCheckHandler, ShutdownHandler, WatchtowerConfiguration } from './types';

const log = util.debuglog('watchtower');

const defaultConfiguration: Required<WatchtowerConfiguration> = {
  shutdownDelay: -1,
  gracefulShutdownTimeoutPeriod: 30_000,
  shutdownHandlerTimeoutPeriod: 5_000,
  healthCheckTimeoutPeriod: 500,
  signals: ['SIGTERM', 'SIGINT', 'SIGHUP'],
};
 
export class Watchtower {
  public readonly startupDurationMetric = new Gauge({
    name: 'watchtower_startup_duration_milliseconds',
    help: 'Time between watchtower instance was created and it became ready for the first time',
  });

  private readonly configuration: Required<WatchtowerConfiguration>;
  private readonly eventEmitter = new EventEmitter();
  private readonly blockingTasks: BlockingTask[] = [];
  private readonly shutdownHandlers: ShutdownHandler[] = [];
  private readonly beacons: Beacon[] = [];
  private readonly healthCheckHandlers: HealthCheckHandler[] = [];
  private resolveFirstReady!: (value: unknown) => void;
  private rejectFirstReady!: (reason?: never) => void;
  private readonly deferredFirstReady;
  private _isServerShuttingDown = false;
  private _isServerReady = false;
  private _isServerHealthy = false;
  private readonly startTime = process.hrtime();
  private startupDuration?: [number, number];

  constructor(userConfiguration?: WatchtowerConfiguration) {
    this.configuration = { ...defaultConfiguration, ...userConfiguration };

    this.deferredFirstReady = new Promise((resolve, reject) => {
      this.resolveFirstReady = resolve;
      this.rejectFirstReady = reject;
    });

    this.deferredFirstReady
      .then(() => {
        // logger.info('service has become available for the first time');

        this.startupDuration = process.hrtime(this.startTime);

        this.startupDurationMetric.set(this.startupDuration[0] * 1000 + this.startupDuration[1] / 1000000);
      })
      .catch(async (/*err*/) => {
        // logger.error(new Error("service couldn't become available", { cause: err }));
        await this.shutdown();
      });

    this.registerSignals();
  }

  isServerReady(): boolean {
    if (this.blockingTasks.length > 0) {
      return false;
    }

    return this._isServerReady;
  }

  isServerShuttingDown(): boolean {
    return this._isServerShuttingDown;
  }

  async isServerHealthy(): Promise<boolean> {
    const handlersPassing = await this.areHealthCheckHandlersPassing();
    this._isServerHealthy = this._isServerHealthy && handlersPassing;

    return this._isServerHealthy && this.isServerReady() && !this.isServerShuttingDown();
  }

  registerShutdownHandler(shutdownHandler: ShutdownHandler): void {
    this.shutdownHandlers.push(shutdownHandler);
  }

  queueBlockingTask(blockingTask: BlockingTask): void {
    this.blockingTasks.push(blockingTask);

    blockingTask
      .then(() => {
        const index = this.blockingTasks.indexOf(blockingTask);
        this.blockingTasks.splice(index, 1);

        if (this.isServerReady()) {
          this.resolveFirstReady(null);
        }
      })
      .catch((err) => {
        // logger.error(new Error('startup task failed', { cause: err }));
        this.rejectFirstReady(err);
      });
  }

  createBeacon(context?: BeaconContext): BeaconController {
    const beacon = {
      context: context ?? {},
    };

    this.beacons.push(beacon);

    return {
      die: async () => {
        // logger.debug('beacon has been killed', { beacon });

        const index = this.beacons.indexOf(beacon);
        this.beacons.splice(index, 1);

        this.eventEmitter.emit('beaconStateChange');

        await new Promise((res) => setTimeout(res, 0));
      },
    };
  }

  registerHealthCheckHandler(healthCheckHandler: HealthCheckHandler): void {
    this.healthCheckHandlers.push(healthCheckHandler);
  }

  signalReady(): void {
    if (this.isServerShuttingDown()) {
      return;
    }

    if (this.blockingTasks.length > 0) {
      // logger.debug('service will not become immediately ready because there are blocking tasks queued');
    }

    this._isServerReady = true;
    this.signalHealthy();

    if (this.blockingTasks.length === 0) {
      this.resolveFirstReady(null);
    }
  }

  signalHealthy(): void {
    if (this.isServerShuttingDown()) {
      return;
    }

    this._isServerHealthy = true;
  }

  signalUnhealthy(): void {
    if (this.isServerShuttingDown()) {
      return;
    }

    this._isServerHealthy = false;
  }

  async shutdown(): Promise<void> {
    if (this.isServerShuttingDown()) {
      // logger.warn('service is already shutting down');
      return;
    }

    // logger.info('received request to shutdown the service');
    this._isServerShuttingDown = true;

    // Adding delay to ensure all the proxies have done their job
    // https://freecontent.manning.com/handling-client-requests-properly-with-kubernetes/
    if (this.configuration.shutdownDelay >= 0) {
      await new Promise((res) => setTimeout(res, this.configuration.shutdownDelay));
    }

    this._isServerHealthy = false;
    this._isServerReady = false;

    const gracefulShutdownTimeout = setTimeout(() => {
      // logger.warn('graceful shutdown period ended, forcing process termination');
      this.terminate(1);
    }, this.configuration.gracefulShutdownTimeoutPeriod);

    gracefulShutdownTimeout.unref();

    if (this.beacons.length > 0) {
      await new Promise<void>((resolve) => {
        const check = (): void => {
          // logger.verbose('checking if there are any live beacons');

          if (this.beacons.length > 0) {
            // logger.debug('program termination is on hold because there are live beacons', { beacons: this.beacons });
          } else {
            // logger.verbose('there aren\'t any live beacons left');

            this.eventEmitter.off('beaconStateChange', check);

            resolve();
          }
        };

        this.eventEmitter.on('beaconStateChange', check);

        check();
      });
    }

    clearTimeout(gracefulShutdownTimeout);

    const shutdownHandlerTimeout = setTimeout(() => {
      // logger.warn('shutdown handler period ended, forcing process termination');
      this.terminate(1);
    }, this.configuration.shutdownHandlerTimeoutPeriod);

    shutdownHandlerTimeout.unref();

    for (const shutdownHandler of this.shutdownHandlers) {
      try {
        await shutdownHandler();
      } catch (err) {
        // logger.error(new Error('shutdown handler produced an error', { cause: err }));
      }
    }

    clearTimeout(shutdownHandlerTimeout);

    // logger.verbose('all shutdown handlers have run to completion');

    setTimeout(() => {
      // logger.warn('process did not exit on its own, investigate what is keeping the event loop active');

      this.terminate(1);
    }, 1_000).unref();

    // logger.info('bye!');
  }

  private async areHealthCheckHandlersPassing(): Promise<boolean> {
    const healthCheckTimeout = setTimeout(() => {
      // logger.warn('health check shutdown period ended, service deemed unhealthy');
      return false;
    }, this.configuration.healthCheckTimeoutPeriod);

    healthCheckTimeout.unref();

    for (const healthCheckHandler of this.healthCheckHandlers) {
      try {
        await healthCheckHandler();
      } catch (err) {
        // logger.error(new Error('health check handler produced an error', { cause: err }));
        return false;
      }
    }

    clearTimeout(healthCheckTimeout);

    return true;
  }

  private registerSignals(): void {
    for (const signal of this.configuration.signals) {
      process.on(signal, () => {
        void this.shutdown();
      });
    }
  }

  private terminate(code: number): void {
    process.exit(code);
  }
}
