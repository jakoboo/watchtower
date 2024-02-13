import { type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'http';
import { type Server as HttpsServer } from 'https';
import { type Socket } from 'net';
import { clearTimeout } from 'timers';
import { HttpServerManagerConfiguration, ConnectionManager } from './types';
// import { logger } from '@logger';

const isIdle = Symbol('isIdle');

declare module 'net' {
  interface Socket {
    [isIdle]: boolean;
  }
}

const defaultConfiguration: Required<HttpServerManagerConfiguration> = {
  closeActiveConnectionsTimeoutPeriod: 1_000,
};

export class HttpServerManager implements ConnectionManager {
  private readonly configuration: Required<HttpServerManagerConfiguration>;
  private readonly server: HttpServer | HttpsServer;

  // Map for tracking opened http connections.
  private readonly connections = new Map<symbol, Socket>();

  private isServerClosing = false;

  constructor(server: HttpServer | HttpsServer, userConfiguration?: HttpServerManagerConfiguration) {
    this.configuration = {
      ...defaultConfiguration,
      ...userConfiguration,
    };
    this.server = server;

    this.startWatchingServer();
  }

  /**
   * Initiates graceful termination of the server.
   * It first asks server to stop accepting new requests and then
   * terminates all open idle connections.
   * By putting the server into termination phase all active connections
   * would be automatically terminated after requests are properly complete,
   * or the closeActiveConnectionsTimeout will pass.
   */
  public async close(): Promise<void> {
    this.isServerClosing = true;

    for (const socket of this.connections.values()) {
      this.closeIdleConnection(socket);
    }

    const closeActiveConnectionsTimeout = setTimeout(() => {
      // logger.verbose('closing active connections...');

      for (const socket of this.connections.values()) {
        socket.destroy();
      }
    }, this.configuration.closeActiveConnectionsTimeoutPeriod);
    closeActiveConnectionsTimeout.unref();

    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err != null) {
          reject(err);
        }

        if (closeActiveConnectionsTimeout != null) {
          clearTimeout(closeActiveConnectionsTimeout);
        }

        resolve();
      });
    });
  }

  private startWatchingServer(): void {
    this.server.on('connection', this.onConnection.bind(this));
    this.server.on('request', this.onRequest.bind(this));
  }

  /**
   * Initializes new connection by adding idle flag to it and
   * tracks the connection inside internal list.
   */
  private onConnection(connection: Socket | any): void {
    const symbol = Symbol('Socket');

    // Marking connection as idle initially.
    connection[isIdle] = true;

    // Adding connection to the list.
    this.connections.set(symbol, connection);

    // Removing connection from the list when it's closed.
    connection.on('close', () => this.connections.delete(symbol));
  }

  /**
   * Changes connection status to active during the request.
   * Makes sure that connection is closed when request is finished during
   * shutdown phase.
   */
  private onRequest(request: IncomingMessage, response: ServerResponse): void {
    const connection = request.socket as any;

    // Marking connection as active.
    connection[isIdle] = false;

    response.on('finish', () => {
      // Marking connection as idle.
      connection[isIdle] = true;

      // Closing the connection after request is processed when
      // we are in closing phase.
      if (this.isServerClosing) {
        this.closeIdleConnection(connection);
      }
    });
  }

  /**
   * Destroys the connection if it's inactive.
   */
  private closeIdleConnection(connection: Socket): void {
    if (connection[isIdle]) {
      connection.destroy();
    }
  }
}
