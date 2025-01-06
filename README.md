# REDSYNC

**Redsync** is a custom Redis server implementation in Node.js. It supports essential Redis-like functionalities such as key-value storage, replication, transactions, and stream processing. Redsync is built with an emphasis on simplicity, modularity, and customizability.

## Features

- **Core Commands**:
  - `SET`, `GET`, `INCR`, `KEYS`, `PING`, `ECHO`
- **Transactions**:
  - Commands like `MULTI`, `EXEC`, and `DISCARD` for atomic transactions
- **Stream Support**:
  - Stream operations such as `XADD`, `XRANGE`, and `XREAD`
  - Blocking reads with `XREAD BLOCK`
- **Replication**:
  - Configurable as a master or slave using the `--replicaof` flag
- **Persistence**:
  - Reads RDB files for persistence
- **Configurable Server**:
  - Supports custom ports, directories, and filenames using CLI arguments
