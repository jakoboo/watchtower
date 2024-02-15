# Watchtower

[![npm version](https://badge.fury.io/js/@jakoboo%2Fwatchtower.svg)](https://badge.fury.io/js/@jakoboo%2Fwatchtower)
[![NPM Install Size](https://badgen.net/packagephobia/install/@jakoboo/watchtower)](https://packagephobia.com/result?p=@jakoboo/watchtower)
[![NPM Downloads](https://badgen.net/npm/dm/@jakoboo/watchtower)](https://npmcharts.com/compare/@jakoboo/watchtower?minimal=true)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jakoboo/watchtower/blob/main/LICENSE)

Graceful shutdown library for Node.js applications.

**This library is not production-ready yet, and the API is subject to change.**

```bash
npm install @jakoboo/watchtower
```

## Features:

- ✨ **Graceful Shutdowns:** Handle shutdowns gracefully with configurable timeout periods.
- ⏳ **Startup Tasks:** Queue tasks to be executed on startup and ensure your application is ready.
- ☠️ **Shutdown Tasks:** Queue tasks to be executed on shutdown, close connections, release resources, etc.
- 🚦 **Beacons:** Create and manage beacons to prevent your application from closing.
- ❤️‍🩹 **Health Check Handlers:** Implement health checks at multiple points in your code.

## To do:
- [ ] Usage examples.
- [ ] Unit tests.

## Usage
```javascript
const { Watchtower } = require('@jakoboo/watchtower');
const watchtower = new Watchtower();

// Your application's startup code.

// Queue a startup task that will be executed before the application is ready.
watchtower.queueStartupTask(/* promise to be awaited */);

// Register a shutdown task that will be executed when the application is shutting down.
watchtower.registerShutdownTask(async () => {
  // Your application's shutdown code.
  // For example, close database connections, release resources, etc.
});

// Signal watchtower that we are done, and it can become ready whenever queued startup tasks are resolved.
watchtower.ready();
```

### Express.js Graceful Shutdown

Gracefully shutdown of an express server requires us to register a shutdown task that closes the server and waits for all connections to be closed before resolving the promise.
For a complete example, see the [express example](./examples/express) directory.

```javascript
const { createServer } = require('http');
const { Watchtower } = require('@jakoboo/watchtower');
const express = require('express');
const watchtower = new Watchtower();

[...]

// We have to create our own server as express instance doesn't hold a reference to it
const app = express();
const expressServer = createServer(app);

// Gracefully shutdown the http server
watchtower.registerShutdownTask(async () => {
    await new Promise((resolve, reject) => {
        let connectionsTimeout;

        // Close server to stop accepting new connections
        expressServer.close((err) => {
            if (err) {
                // Server was not open when it was closed
                reject(err);
            }

            if (connectionsTimeout) {
                // Clear the timeout if all connections are closed before the timeout
                clearTimeout(connectionsTimeout);
            }

            // Server and all connections are closed
            resolve();
        });

        expressServer.closeIdleConnections();

        // Close all connections after a timeout
        connectionsTimeout = setTimeout(() => {
            expressServer.closeAllConnections();
        }, 1000).unref();
    });
});

[...]

// Signal watchtower that we are done, and it can become ready whenever queued startup tasks are resolved.
void watchtower.ready();
```

## Examples

Examples can be found in the [examples](./examples) directory.
To run the examples, clone the repository and run the following commands:

```bash
pnpm install
pnpm run build
```

Then navigate to the `examples` directory and run the example you want to try.

```bash
node examples/express/index.js
```

## Contributing
All contributions are welcome!

## License

[MIT](LICENSE)