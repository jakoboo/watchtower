# Watchtower

[![NPM Version](https://badge.fury.io/js/@jakoboo/watchtower.svg)](https://www.npmjs.com/package/@jakoboo/watchtower)
[![NPM Install Size](https://badgen.net/packagephobia/install/@jakoboo/watchtower)](https://packagephobia.com/result?p=@jakoboo/watchtower)
[![NPM Downloads](https://badgen.net/npm/dm/@jakoboo/watchtower)](https://npmcharts.com/compare/@jakoboo/watchtower?minimal=true)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jakoboo/watchtower/blob/main/LICENSE)

Graceful shutdown library for Node.js applications.

```bash
npm install @jakoboo/watchtower
```

## Features:

- **Graceful Shutdowns:** Handle shutdowns gracefully with configurable timeout periods.
- **Blocking Tasks:** Queue tasks to be executed on startup and ensure your application is ready.
- **Beacons:** Create and manage beacons to prevent your application from closing.
- **Health Check Handlers:** Implement health checks at multiple points in your code.

## To do:
- [ ] Usage examples.
- [ ] Unit tests.

## Usage
```javascript
const { Watchtower } = require('@jakoboo/watchtower');
const watchtower = new Watchtower({
    // Delay before the shutdown sequence starts.
    // https://freecontent.manning.com/handling-client-requests-properly-with-kubernetes/
    shutdownDelay: 1_000, // Default: -1 (disabled).
    
    // Max total time before process is killed (if graceful shutdown fails).
    gracefulShutdownTimeoutPeriod: 30_000, // Default: 30000ms.

    // Timeout period for shutdown handlers.
    shutdownHandlerTimeoutPeriod: 5_000, // Default: 5000ms.

    // Timeout period for health checks.
    healthCheckTimeoutPeriod: 500, // Default: 500ms.
    
    // Termination signals to listen for. All events emitted by process.on() are supported.
    signals: ['SIGTERM', 'SIGINT', 'SIGHUP'] // Default: ['SIGTERM', 'SIGINT', 'SIGHUP'].
});

// Your application's startup code.

// Register a blocking task that will be executed before the application is ready.
watchtower.registerBlockingTask(/* promise to be awaited */);

// Register a shutdown handler that will be called when the application is shutting down.
watchtower.registerShutdownHandler(async () => {
  // Your application's shutdown code.
  // For example, close database connections, release resources, etc.
});

// Signal watchtower that we are done, and it can become ready whenever queue blocking tasks are resolved.
watchtower.signalReady();
```

## Contributing
All contributions are welcome!

## License

[MIT](LICENSE)