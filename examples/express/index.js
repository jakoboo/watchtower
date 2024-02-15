const { createServer } = require('http');
const express = require('express');
const { Watchtower } = require('../../dist/cjs');

const watchtower = new Watchtower();
watchtower.on('ready', () => {
  console.log('Watchtower is ready');
});
watchtower.on('shutdown', (reason) => {
  console.log('Watchtower is shutting down, reason:', reason);
});
watchtower.on('close', () => {
  console.log('Watchtower has closed');
});
watchtower.on('error', (err) => {
  console.error(err);
});

const app = express();

app.get('/', (req, res) => {
  res.send('Hello World');
});

app.get('/health', async (req, res) => {
  if (await watchtower.isHealthy()) {
    res.send('OK');
  } else {
    res.status(503).send('Service Unavailable');
  }
});

// We have to create our own server as express instance doesn't hold a reference to the server
const expressServer = createServer(app);

// Queue server start up as a blocking task so that watchtower knows when it can become ready
watchtower.queueBlockingTask(new Promise((resolve, reject) => {
  expressServer
    .listen(8080, () => {
      console.log('server started at port: 8080');

      resolve();
    })
    .on('error', (err) => {
      reject(err);
    });
}));

// Queue a blocking task to simulate a long running task
watchtower.queueBlockingTask(new Promise((resolve) => {
  setTimeout(() => {
    console.log('Long running blocking task is done');
    resolve();
  }, 5_000);
}));

// Gracefully shutdown the http server
watchtower.registerShutdownHandler(async () => {
  await new Promise((resolve, reject) => {
    let connectionsTimeout;

    // Close server to stop accepting new connections
    expressServer.close((err) => {
      if (err) {
        // Server was not open when it was closed
        reject(err);
      }

      if (connectionsTimeout) {
        clearTimeout(connectionsTimeout);
      }

      // Server closed and all connections are closed
      resolve();
    });

    expressServer.closeIdleConnections();

    // Close all connections after a timeout
    connectionsTimeout = setTimeout(() => {
      expressServer.closeAllConnections();
    }, 1000);
    connectionsTimeout.unref();
  });
});

// Signal watchtower that we are done, and it can become ready whenever queue blocking tasks are resolved.
void watchtower.ready();