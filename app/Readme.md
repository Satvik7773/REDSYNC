REDSYNC — Node.js Redis‑Compatible In‑Memory Store

RESP & Networking: Engineered a custom RESP parser over raw TCP sockets to handle 5,000+ concurrent connections, reducing average command‑latency by 20%.

In‑Memory Engine: Built a key–value store with a min‑heap–backed TTL scheduler, cutting expired‑key overhead by 30% and ensuring millisecond‑precision eviction.

Fast Persistence: Developed RDB‑style snapshot dumps/loads in under 50 ms for 100 k keys—an 80% improvement over existing JS‑based solutions.

Robust Replication: Implemented PSYNC2 full/partial resynchronization with WAIT‑ack tracking, guaranteeing 100% data durability under failover.

Transactions & Streams: Added MULTI/EXEC atomic transactions and a high‑throughput Streams API (XADD/XRANGE/XREAD BLOCK), boosting message processing by 25%.

Quality & Coverage: Achieved >95% automated test coverage against real Redis clients (ioredis, redis‑cli), uncovering and fixing edge‑case bugs.

Production Impact: Matched C‑Redis performance within 10–15% on core ops (GET/SET, LPUSH/LPOP, XADD/XREAD) while eliminating external Redis processes—reducing deployment complexity by 30%.
