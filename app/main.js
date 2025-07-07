const net = require("net");
const readline = require("readline");
const fs = require("fs");
var PORT = 6379;
const crypto = require('crypto');
const { Server } = require("http");
const { count } = require("console");
const { send } = require("process");
var prevstremtime=0;
var prevstreamnum=0;
const replicas = [];
const base64 = "UkVESVMwMDEx+glyZWRpcy12ZXIFNy4yLjD6CnJlZGlzLWJpdHPAQPoFY3RpbWXCbQi8ZfoIdXNlZC1tZW3CsMQQAPoIYW9mLWJhc2XAAP/wbjv+wP9aog=="
const rdbBuffer = Buffer.from(base64, "base64");
const rdbHead = Buffer.from(`$${rdbBuffer.length}\r\n`)
let propagated_commands=0;
var length_of_propagated_commands=0;
let transactions = new Map(); 
let mutlicheck=false;
function calculateCommandLength(command) {
  return command.length;
}
function generateRandomId(length = 40) {
  return crypto.randomBytes(length)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, length);
}
function toRESP(data) {
  if (data === null || data === undefined) {
    return "$-1\r\n";  // Null bulk string
  }

  if (Array.isArray(data)) {
    const elements = data.map(item => toRESP(item));
    return `*${data.length}\r\n${elements.join('')}`;
  }

  if (typeof data === 'number') {
    data = data.toString();
  }

  if (typeof data === 'string') {
    // if (/^-?\d+$/.test(data)) {
    //     return `:${data}\r\n`;
    // }

    if (data.startsWith('ERROR')) {
      return `-${data}\r\n`;
    }

    return `$${data.length}\r\n${data}\r\n`;
  }

  throw new Error('Unsupported data type');
}
/**
 * Parse exactly one full RESP array from buf.
 * Returns { commandArray, bytesConsumed } or null if incomplete.
 */
function tryParseOneRESP(buf) {
  if (buf.length < 4 || buf[0] !== 42 /* '*' */) return null;
  const headerEnd = buf.indexOf('\r\n');
  if (headerEnd < 0) return null;

  const count = parseInt(buf.slice(1, headerEnd).toString(), 10);
  let pos = headerEnd + 2;
  const out = [];

  for (let i = 0; i < count; i++) {
    if (pos >= buf.length || buf[pos] !== 36 /* '$' */) return null;
    const lenEnd = buf.indexOf('\r\n', pos);
    if (lenEnd < 0) return null;

    const strLen = parseInt(buf.slice(pos + 1, lenEnd).toString(), 10);
    pos = lenEnd + 2;
    if (pos + strLen + 2 > buf.length) return null;

    out.push(buf.slice(pos, pos + strLen).toString());
    pos += strLen + 2;
  }

  return { commandArray: out, bytesConsumed: pos };
}

var repliId = "8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb";
var offset = 0;
var hashmap = new Map();
var hashinfo = new Map();
var streammap=new Map();
var master1 = NaN;
const args = process.argv.slice(0);
hashinfo.set('role', 'master');

function remove(key, expiryTime) {
  const expiry = Number(expiryTime);
  const now = Date.now();

  const timeToExpiry = expiry - now;

  if (timeToExpiry > 0) {
    if (timeToExpiry > 2147483647) {
      const interval = setInterval(() => {
        const remaining = Number(expiryTime) - Date.now();
        if (remaining <= 2147483647) {
          clearInterval(interval);
          setTimeout(() => {
            hashmap.delete(key);
          }, remaining);
        }
      }, 60000);
    } else {
      setTimeout(() => {
        hashmap.delete(key);
      }, timeToExpiry);
    }
  } else {
    hashmap.delete(key);
  }
}

function parseArgs(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
      PORT = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--replicaof') {
      hashinfo.set('role', 'slave');
      const [host, port] = args[i + 1].split(' ');
      master1 = parseInt(port);
      console.log(`Configuring as slave. Master host: ${host}, port: ${master1}`);
      i++;
    } else if (args[i] === '--dir') {
      hashmap.set('dir', args[i + 1]);
      i++;
    } else if (args[i] === '--dbfilename') {
      hashmap.set('dbfilename', args[i + 1]);
      i++;
    }
  }
}
hashinfo.set('master_replid', repliId);//d
hashinfo.set('master_repl_offset', offset);
parseArgs(args);
let client;
if (!isNaN(master1))
   {
  console.log("Connecting to master on port:", master1);
  client = net.connect({
    port: master1,
    host: "127.0.0.1"
  }, function () {
    console.log("Connected to master");
    client.write(toRESP(["PING"]));
  });

  let buffer = Buffer.from('');
  let isProcessingRDB = false;
  let rdbLength = 0;
  let handshakeStep = 0;
  let processedBytes = 0;
  let countstart=false;
  let offset = 0;
  
  client.on('data', (data) => {
  

    buffer = Buffer.concat([buffer, data]);
    if(handshakeStep === 3&&countstart)
      {
      offset+=data.length;
    }
    let check = false;
    while (buffer.length > 0) {
      // Handle RDB file transfer first
      if (buffer[0] === 36 && !isProcessingRDB) { // '$' character for RDB length
        const endIndex = buffer.indexOf('\r\n');
        if (endIndex === -1) break;

        rdbLength = parseInt(buffer.slice(1, endIndex));
        isProcessingRDB = true;
        buffer = buffer.slice(endIndex + 2);
        continue;
      }

      if (isProcessingRDB) {
        if (buffer.length < rdbLength) break;
        countstart=true;
        console.log("Processing RDB file");
        buffer = buffer.slice(rdbLength);
        isProcessingRDB = false;
        continue;
      }

      if (buffer[0] === 42) {
        const endIndex = buffer.indexOf('\r\n');
        if (endIndex === -1) break;

        const count = parseInt(buffer.slice(1, endIndex));
        let pos = endIndex + 2;
        let complete = true;
        let elements = [];

        for (let i = 0; i < count; i++) {
          if (pos >= buffer.length) {
            complete = false;
            break;
          }

          if (buffer[pos] === 36) {
            const lenEnd = buffer.indexOf('\r\n', pos);
            if (lenEnd === -1) {
              complete = false;
              break;
            }

            const strLen = parseInt(buffer.slice(pos + 1, lenEnd));
            pos = lenEnd + 2;

            if (pos + strLen + 2 > buffer.length) {
              complete = false;
              break;
            }

            elements.push(buffer.slice(pos, pos + strLen).toString());
            pos += strLen + 2;
          }
        }

        if (!complete) break;
        if (elements[0].toUpperCase() === 'REPLCONF' && elements[1].toUpperCase() === 'GETACK') {
          countstart=true;
          let off = offset.toString();
          client.write(toRESP(["REPLCONF", "ACK", off]));
        }
        if (elements[0].toUpperCase() === 'SET') {
          const key = elements[1];
          const value = elements[2];
          hashmap.set(key, { value: value, expireTime: null });
        }
      
        buffer = buffer.slice(pos);
      }
      else if (buffer[0] === 43) {
        const endIndex = buffer.indexOf('\r\n');
        if (endIndex === -1) break;

        const response = buffer.slice(0, endIndex + 2).toString();
        buffer = buffer.slice(endIndex + 2);

        if (response === "+PONG\r\n") {
          client.write("*3\r\n$8\r\nREPLCONF\r\n$14\r\nlistening-port\r\n$4\r\n" + PORT + "\r\n");
          handshakeStep = 1;
        }
        else if (response === "+OK\r\n") {
          if (handshakeStep === 1) {
            client.write("*3\r\n$8\r\nREPLCONF\r\n$4\r\ncapa\r\n$6\r\npsync2\r\n");
            handshakeStep = 2;
          }
          else if (handshakeStep === 2) {
            client.write(toRESP(["PSYNC", "?", "-1"]));
            handshakeStep = 3;
          }
        }
       
      }
      else {
        const nextNewline = buffer.indexOf('\r\n');
        if (nextNewline === -1) {
          buffer = Buffer.from('');
        } else {
          buffer = buffer.slice(nextNewline + 2);
        }
      }
    }
  });

  client.on('error', (err) => {
    console.error('Connection error:', err);
  });

  client.on('close', () => {
    console.log('Connection to master closed');
  });
}

const propagte = (data) => {
  propagated_commands++;
  length_of_propagated_commands+=calculateCommandLength(data);
  console.log('Propagating data:', data);
  if (hashinfo.get('role') === 'master') {
    for (let replica of replicas) {
      replica.write(data);
    }
  }
  else return;
};

const dirname = hashmap.get('dir');
const dbfilename = hashmap.get('dbfilename');
const filePath = dirname + '/' + dbfilename;

const readRdbFile = () => {
  const opCodes = {
    resizeDb: "fb",
    miliExp: "fc",
    eof: "ff",
  };
  let i = 0;
  let dataBuffer;
  try {
    dataBuffer = fs.readFileSync(filePath);
  } catch (e) {
    console.log("Error:", e);
    return;
  }
  console.log("Hex data:", dataBuffer.toString("hex"));

  const getNextNBytes = (n) => {
    let nextNBytes = Buffer.alloc(n);
    for (let k = 0; k < n; k++) {
      nextNBytes[k] = dataBuffer[i];
      i++;
    }
    return nextNBytes;
  };

  const getNextObjLength = () => {
    const firstByte = dataBuffer[i];
    const twoBits = firstByte >> 6;
    let length = 0;
    switch (twoBits) {
      case 0b00:
        length = firstByte ^ 0b00000000;
        i++;
        break;
    }
    return Number(length);
  };

  const getKeyValues = (n) => {
    let expiryTime = null;
    for (let j = 0; j < n; j++) {
      if (dataBuffer[i].toString(16) === opCodes.miliExp) {
        i++;
        expiryTime = dataBuffer.readBigUInt64LE(i);
        i += 8;
        console.log("expiryTime:", expiryTime);
      }
      if (dataBuffer[i].toString(16) === "0") {
        i++;
      }
      const keyLength = getNextObjLength();
      const key = getNextNBytes(keyLength).toString();
      const valueLength = getNextObjLength();
      const value = getNextNBytes(valueLength).toString();
      console.log(`Setting ${key} to ${value}`);

      if (expiryTime) {
        hashmap.set(key, { value: value, expireTime: Number(expiryTime) });
        remove(key, expiryTime);
      } else {
        hashmap.set(key, { value: value, expireTime: null });
      }
      expiryTime = null; // Reset for next key-value pair
    }
  };

  const resizeDb = () => {
    console.log("Inside resizedb");
    i++;
    const totalKeyVal = getNextObjLength();
    console.log("Total keyval:", totalKeyVal);
    const totalExpiry = getNextObjLength();
    if (totalExpiry === 0) i++;

    getKeyValues(totalKeyVal);
  };

  while (i < dataBuffer.length) {
    const currentHexByte = dataBuffer[i].toString(16);
    if (currentHexByte === opCodes.resizeDb) {
      console.log("currentHexByte:", currentHexByte);
      resizeDb();
    } else if (currentHexByte === opCodes.eof) {
      console.log("Breaking reading rdb buffer");
      break;
    } else {
      i++;
    }
  }
  return null;
};

if (fs.existsSync(filePath)) {
  readRdbFile();
}
function sendData(conn, inp) {
  var input = inp.toString();
  var cont = input.split("\r\n");

  if (cont.length < 2) {
    cont = input.toUpperCase();
    if (cont === "PING") {
      return "+PONG";
    }
    return "-ERR unknown command";
  }

  var cmd;
  if (cont[0][0] === "*") {
    cmd = cont[2].toUpperCase();
  } else if (cont[0][0] === "$") {
    cmd = cont[1].toUpperCase();
  }

  if (cmd === "SET") {
    var key = cont[4];
    var value = cont[6];
    var ttl = null;
 
    if (cont[8] !== undefined) {
      var expType = cont[8].toUpperCase();
      if (expType === "EX" || expType === "PX") {
        ttl = parseInt(cont[10]);
        if (expType === "EX") {
          ttl *= 1000;
        }
        const expireTime = Date.now() + ttl;
        hashmap.set(key, { value: value, expireTime: expireTime });
        remove(key, expireTime);
      }
    } else {
      hashmap.set(key, { value: value, expireTime: null });
    }
    return "+OK";
  } else if (cmd === "GET") {
    var key = cont[4];
    if (hashmap.has(key)) {
      var entry = hashmap.get(key);
      if (entry.expireTime === null || entry.expireTime > Date.now()) {
        return `$${entry.value.length}\r\n${entry.value}`;
      } else {
        hashmap.delete(key);
        return "$-1";
      }
    }
    return "$-1";
  } else if (cmd === "INCR") {
    var key = cont[4];
    if (hashmap.has(key)) {
      var entry = hashmap.get(key);
      var newValue = parseInt(entry.value);
      if(isNaN(newValue))
      {
        return "-ERR value is not an integer or out of range";
      }
      newValue=newValue+1;
      hashmap.set(key, { value: String(newValue), expireTime: entry.expireTime });
      return `:${newValue}`;
    } else {
      hashmap.set(key, { value: "1", expireTime: null });
      return ":1";
    }
  }

  return "-ERR unknown command";
}

// const server = net.createServer(function (conn) 
// {

//   let queue= [];
//   conn.on("data", function (inp) {
//     var input = inp.toString();
//     var cont = input.split("\r\n");

//     if (cont.length < 2) {
//       cont = input.toUpperCase();
//       if (cont == "PING") {
//         conn.write("+PONG\r\n");
//       }
//       return;
//     }

//     var cmd;
//     if (cont[0][0] === '*') {
//       cmd = cont[2].toUpperCase();
//     } else if (cont[0][0] === '$') {
//       cmd = cont[1].toUpperCase();
//     }

//     if(queue.length > 0 && cmd !== "EXEC" && cmd !== "MULTI" && cmd != "DISCARD")
//     {//d
//         queue.push(input);
//        conn.write("+QUEUED\r\n");
//     }

//     else if (cmd === "EXEC") 
//       {
//       if (queue.length === 0) {
//           conn.write("-ERR EXEC without MULTI\r\n");
//       } 
//      else if(queue.length === 1) 
//         {
//         conn.write("*0\r\n");
//         queue.shift();
//     }
//     else
//     {
//       const responses = [];
//       while (queue.length > 0) {
//         const queuedCommand = queue.shift();
//         if(queuedCommand != "chalu")
//         {
//         const response = sendData(conn, queuedCommand); 
//         responses.push(response);
//         }
//       }
//       let respArray = `*${responses.length}\r\n`;
//       for (const response of responses) {
//         if (response.startsWith("+") || response.startsWith("-") || response.startsWith(":")) {
//           respArray += `${response}\r\n`;
//         } else {
//           const lines = response.split("\r\n");
//           respArray += `${lines[0]}\r\n${lines[1]}\r\n`;
//         }
//       }
//       mutlicheck = false;
//       conn.write(respArray);
//     }
//   } 
//     else if (cmd === "MULTI") 
//       {
//         mutlicheck=true;
//       if (queue.length ===0) {
//           queue.push("chalu"); 
//           conn.write("+OK\r\n");
//       } else {
//           conn.write("-ERR MULTI already in progress\r\n");
//       }
//     }
//     else if(cmd === "DISCARD")
//     {
//       if(queue.length > 2)
//       {
//          queue=[];
//          conn.write("+OK\r\n");
//       }
//       else
//       {
//         conn.write("-ERR DISCARD without MULTI\r\n");
//       }
//     }
    
//   else  if (cmd === "ECHO") {
//       var s = cont[4];
//       var size = s.length;
//       conn.write("$" + size + "\r\n" + s + "\r\n");
//     } else if (cmd === "PING") {
//       conn.write("+PONG\r\n");
//     }
//     else if (cmd === "SET") {
//       var key = cont[4];
//       var value = cont[6];
//       var ttl = null;

//       if (cont[8] !== undefined) {
//         var expType = cont[8].toUpperCase();
//         if (expType === "EX" || expType === "PX") {
//           ttl = parseInt(cont[10]);
//           if (expType === "EX") {
//             ttl *= 1000;
//           }
//           const expireTime = Date.now() + ttl;
//           hashmap.set(key, { value: value, expireTime: expireTime });
//           remove(key, BigInt(expireTime));//g
//         }
//       } else {
//         hashmap.set(key, { value: value, expireTime: null });
//       }
          
//       conn.write("+OK\r\n");
//       propagte(input);
//     } 
//     else if (cmd === "GET") {
//       var key = cont[4];
//       if (hashmap.has(key)) {
//         var entry = hashmap.get(key);
//         if (entry.expireTime === null || entry.expireTime > Date.now()) {
//           var value = entry.value;
//           var size = value.length;
//           conn.write("$" + size + "\r\n" + value + "\r\n");
//         } else {
//           hashmap.delete(key);
//           conn.write("$-1\r\n");
//         }
//       } else {
//         conn.write("$-1\r\n");
//       }
//     } 
//     else if (cmd === "CONFIG" && cont[4].toUpperCase() == "GET") {
//       var key = cont[6];
//       var ans = hashmap.get(key);
//       if (ans) {
//         conn.write("*2\r\n" + "$" + key.length + "\r\n" + key + "\r\n$" + ans.length + "\r\n" + ans + "\r\n");
//       }
//     } else if (cmd === "KEYS") {
//       const pattern = cont[4];
//       if (pattern === "*") {
//         const matchingKeys = [];
//         for (let key of hashmap.keys()) {
//           if (key !== "dir" && key !== "dbfilename" && key !== "") {
//             const entry = hashmap.get(key);
//             if (entry.expireTime === null || entry.expireTime > Date.now()) {
//               matchingKeys.push(key);
//             }
//           }
//         }

//         conn.write(`*${matchingKeys.length}\r\n`);
//         for (let key of matchingKeys) {
//           conn.write(`$${key.length}\r\n${key}\r\n`);
//         }
//       } else {
//         conn.write("*0\r\n");
//       }
//     }
//     else if (cmd === "INFO" && cont[4].toUpperCase() === "REPLICATION") {
//       if (hashinfo.get('role') === 'master') {
//         // Construct the response string
//         const response = [
//           "role:master",
//           "master_replid:8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb",
//           "master_repl_offset:0"
//         ].join("\n");

//         conn.write(`$${response.length}\r\n${response}\r\n`);
//       } else {
//         conn.write("$10\r\nrole:slave\r\n");
//       }
//     }//d
//     else if (cmd === "REPLCONF" && (cont[4] === "listening-port"|| cont[4] === "capa") )
//       {
//         console.log("yahan se");
//       conn.write("+OK\r\n");
//     }

//     else if (cmd === "PSYNC") {
//       conn.write("+FULLRESYNC " + repliId + " " + offset + "\r\n");
//       conn.write(Buffer.concat([rdbHead, rdbBuffer]));
//       replicas.push(conn);
//     }

//     else if (cmd === "WAIT") {
//       console.log(length_of_propagated_commands);
//       const num = parseInt(cont[4]);
//       const timeout = parseInt(cont[6]);
//       const startTime = Date.now();
//       let countOfReplicas = 0;
//         if(length_of_propagated_commands==0){
//           conn.write(":"+replicas.length+"\r\n");
//         }
//         else
//         {
//       const acknowledgedReplicas = new Set();
  
//       const checkTimeout = () => {
//           const elapsed = Date.now() - startTime;
//           if (countOfReplicas >= num || elapsed >= timeout) {
//                 length_of_propagated_commands+="*3\r\n$8\r\nREPLCONF\r\n$6\r\nGETACK\r\n$1\r\n*\r\n".length;
//               conn.write(`:${countOfReplicas}\r\n`);
//           } else {
//               setTimeout(checkTimeout, 10); // Check again after 10ms
//           }
//       };
  
//       for (const replica of replicas) {
//           replica.write("*3\r\n$8\r\nREPLCONF\r\n$6\r\nGETACK\r\n$1\r\n*\r\n");
  
//           replica.on('data', (data) => {
//               const inp1 = data.toString();
//               const cont1 = inp1.split("\r\n");
//               const num1 = parseInt(cont1[6]);
//               console.log("replica sent ",num1,"propagated_commands jo hamne bheja ",length_of_propagated_commands);
  
//               if (num1 === length_of_propagated_commands) {
//                 console.log("entered");
//                   if (!acknowledgedReplicas.has(replica)) {
//                       acknowledgedReplicas.add(replica);
//                       countOfReplicas++;
//                   }
//               }
//           });
//       }
  
//       checkTimeout();
//     }
//   }

//   else if(cmd==="TYPE")
//   {
//     var key=cont[4];
//     console.log(streammap.size);
//     console.log("All keys in streammap:", [...streammap.keys()], "Key:", key);

//     if(hashmap.has(key))
//     {
//       conn.write("+"+typeof(hashmap.get(key).value)+"\r\n");
//     }
//     else if(streammap.has(key))
//     {
//       conn.write("+stream\r\n");
//     }
//     else
//     {
//       conn.write("+none\r\n");
//     }
//   }

//   else if (cmd === "XADD") 
//     {
//      handleXADD(cont, conn);
// }

// else if (cmd === "XRANGE") 
//   {
//     handleXRANGE(cont, conn);
//   }
//   else if(cmd === "XREAD")
//   {
//      if(cont[4].toLocaleUpperCase() ==="BLOCK")
//      {
//        handleXREADBLOCK(cont, conn);
//      }
//      else
//      {
//        handleXREAD(cont, conn);
//      }
//   }
//   else if(cmd === "INCR")
//   {
//     var key=cont[4];
//     if(hashmap.has(key))
//     {//d
//       let val=hashmap.get(key).value;
//       if(isNaN(val))
//       {
//         conn.write("-ERR value is not an integer or out of range\r\n");
//       }
//       val=parseInt(val)+1;

//       hashmap.set(key,{value:(""+val),expireTime:hashmap.get(key).expireTime});
//       conn.write(":"+val+"\r\n");
//     }
//     else
//     {
//       hashmap.set(key,{value:"1",expireTime:null});
//       conn.write(":"+1+"\r\n");
//   }
// }



  

//     });
//   conn.on("end", function () {
//     console.log("Client disconnected");
//   });
  
// });
const server = net.createServer(function (conn) {
  let queue = [];
  let buffer = Buffer.alloc(0); // Add buffer to accumulate data

  conn.on("data", function (data) {
    // Accumulate data in buffer
    buffer = Buffer.concat([buffer, data]);
    
    // Process all complete commands in the buffer
    while (buffer.length > 0) {
      const result = tryParseOneRESP(buffer);
      if (!result) {
        // Not enough data for a complete command, wait for more
        break;
      }
      
      const { commandArray, bytesConsumed } = result;
      buffer = buffer.slice(bytesConsumed);
      
      // Process the command
      processCommand(commandArray, conn, queue);
    }
  });

  conn.on("end", function () {
    console.log("Client disconnected");
  });

  // Move command processing logic to separate function
  function processCommand(commandArray, conn, queue) {
    if (!commandArray || commandArray.length === 0) return;
    
    const cmd = commandArray[0].toUpperCase();
    
    // Handle transaction commands
    if (queue.length > 0 && cmd !== "EXEC" && cmd !== "MULTI" && cmd !== "DISCARD") {
      queue.push(commandArray);
      conn.write("+QUEUED\r\n");
      return;
    }

    if (cmd === "EXEC") {
      if (queue.length === 0) {
        conn.write("-ERR EXEC without MULTI\r\n");
      } else if (queue.length === 1) {
        conn.write("*0\r\n");
        queue.shift();
      } else {
        const responses = [];
        while (queue.length > 0) {
          const queuedCommand = queue.shift();
          if (queuedCommand !== "chalu") {
            const response = executeCommand(queuedCommand, conn);
            responses.push(response);
          }
        }
        let respArray = `*${responses.length}\r\n`;
        for (const response of responses) {
          if (response.startsWith("+") || response.startsWith("-") || response.startsWith(":")) {
            respArray += `${response}\r\n`;
          } else {
            const lines = response.split("\r\n");
            respArray += `${lines[0]}\r\n${lines[1]}\r\n`;
          }
        }
        mutlicheck = false;
        conn.write(respArray);
      }
    } else if (cmd === "MULTI") {
      mutlicheck = true;
      if (queue.length === 0) {
        queue.push("chalu");
        conn.write("+OK\r\n");
      } else {
        conn.write("-ERR MULTI already in progress\r\n");
      }
    } else if (cmd === "DISCARD") {
      if (queue.length > 0) {
        queue = [];
        conn.write("+OK\r\n");
      } else {
        conn.write("-ERR DISCARD without MULTI\r\n");
      }
    } else {
      // Execute regular command
      const response = executeCommand(commandArray, conn);
      if (response) {
        conn.write(response + "\r\n");
      }
    }
  }

  // Extract command execution logic
  function executeCommand(commandArray, conn) {
    const cmd = commandArray[0].toUpperCase();
    
    if (cmd === "ECHO") {
      const s = commandArray[1];
      return `$${s.length}\r\n${s}`;
    } else if (cmd === "PING") {
      return "+PONG";
    } else if (cmd === "SET") {
      const key = commandArray[1];
      const value = commandArray[2];
      let ttl = null;

      if (commandArray.length > 3) {
        const expType = commandArray[3].toUpperCase();
        if (expType === "EX" || expType === "PX") {
          ttl = parseInt(commandArray[4]);
          if (expType === "EX") {
            ttl *= 1000;
          }
          const expireTime = Date.now() + ttl;
          hashmap.set(key, { value: value, expireTime: expireTime });
          remove(key, BigInt(expireTime));
        }
      } else {
        hashmap.set(key, { value: value, expireTime: null });
      }
      
      // Convert commandArray back to RESP format for propagation
      const respCommand = toRESP(commandArray);
      propagte(respCommand);
      return "+OK";
    } else if (cmd === "GET") {
      const key = commandArray[1];
      if (hashmap.has(key)) {
        const entry = hashmap.get(key);
        if (entry.expireTime === null || entry.expireTime > Date.now()) {
          return `$${entry.value.length}\r\n${entry.value}`;
        } else {
          hashmap.delete(key);
          return "$-1";
        }
      } else {
        return "$-1";
      }
    } else if (cmd === "CONFIG" && commandArray[1] && commandArray[1].toUpperCase() === "GET") {
      const key = commandArray[2];
      const ans = hashmap.get(key);
      if (ans) {
        return `*2\r\n$${key.length}\r\n${key}\r\n$${ans.length}\r\n${ans}`;
      }
      return "*0\r\n";
    } else if (cmd === "KEYS") {
      const pattern = commandArray[1];
      if (pattern === "*") {
        const matchingKeys = [];
        for (let key of hashmap.keys()) {
          if (key !== "dir" && key !== "dbfilename" && key !== "") {
            const entry = hashmap.get(key);
            if (entry.expireTime === null || entry.expireTime > Date.now()) {
              matchingKeys.push(key);
            }
          }
        }

        let response = `*${matchingKeys.length}\r\n`;
        for (let key of matchingKeys) {
          response += `$${key.length}\r\n${key}\r\n`;
        }
        return response.slice(0, -2); // Remove last \r\n
      } else {
        return "*0";
      }
    } else if (cmd === "INFO" && commandArray[1] && commandArray[1].toUpperCase() === "REPLICATION") {
      if (hashinfo.get('role') === 'master') {
        const response = [
          "role:master",
          "master_replid:8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb",
          "master_repl_offset:0"
        ].join("\n");
        return `$${response.length}\r\n${response}`;
      } else {
        return "$10\r\nrole:slave";
      }
    } else if (cmd === "REPLCONF" && (commandArray[1] === "listening-port" || commandArray[1] === "capa")) {
      console.log("yahan se");
      return "+OK";
    } else if (cmd === "PSYNC") {
      conn.write("+FULLRESYNC " + repliId + " " + offset + "\r\n");
      conn.write(Buffer.concat([rdbHead, rdbBuffer]));
      replicas.push(conn);
      return null; // Don't send additional response
    } else if (cmd === "WAIT") {
      // Handle WAIT command (complex logic remains the same)
      handleWaitCommand(commandArray, conn);
      return null;
    } else if (cmd === "TYPE") {
      const key = commandArray[1];
      if (hashmap.has(key)) {
        return `+${typeof(hashmap.get(key).value)}`;
      } else if (streammap.has(key)) {
        return "+stream";
      } else {
        return "+none";
      }
    } else if (cmd === "XADD") {
      // Convert commandArray back to cont format for existing function
      const cont = ["*" + commandArray.length, "", ...commandArray.map(cmd => [cmd.length.toString(), cmd]).flat()];
      handleXADD(cont, conn);
      return null;
    } else if (cmd === "XRANGE") {
      const cont = ["*" + commandArray.length, "", ...commandArray.map(cmd => [cmd.length.toString(), cmd]).flat()];
      handleXRANGE(cont, conn);
      return null;
    } else if (cmd === "XREAD") {
      const cont = ["*" + commandArray.length, "", ...commandArray.map(cmd => [cmd.length.toString(), cmd]).flat()];
      if (commandArray[1] && commandArray[1].toUpperCase() === "BLOCK") {
        handleXREADBLOCK(cont, conn);
      } else {
        handleXREAD(cont, conn);
      }
      return null;
    } else if (cmd === "INCR") {
      const key = commandArray[1];
      if (hashmap.has(key)) {
        let val = hashmap.get(key).value;
        if (isNaN(val)) {
          return "-ERR value is not an integer or out of range";
        }
        val = parseInt(val) + 1;
        hashmap.set(key, { value: ("" + val), expireTime: hashmap.get(key).expireTime });
        return `:${val}`;
      } else {
        hashmap.set(key, { value: "1", expireTime: null });
        return ":1";
      }
    }
    
    return "-ERR unknown command";
  }

  // Helper function for WAIT command
  function handleWaitCommand(commandArray, conn) {
    console.log(length_of_propagated_commands);
    const num = parseInt(commandArray[1]);
    const timeout = parseInt(commandArray[2]);
    const startTime = Date.now();
    let countOfReplicas = 0;
    
    if (length_of_propagated_commands == 0) {
      conn.write(":" + replicas.length + "\r\n");
    } else {
      const acknowledgedReplicas = new Set();

      const checkTimeout = () => {
        const elapsed = Date.now() - startTime;
        if (countOfReplicas >= num || elapsed >= timeout) {
          length_of_propagated_commands += "*3\r\n$8\r\nREPLCONF\r\n$6\r\nGETACK\r\n$1\r\n*\r\n".length;
          conn.write(`:${countOfReplicas}\r\n`);
        } else {
          setTimeout(checkTimeout, 10);
        }
      };

      for (const replica of replicas) {
        replica.write("*3\r\n$8\r\nREPLCONF\r\n$6\r\nGETACK\r\n$1\r\n*\r\n");

        replica.on('data', (data) => {
          const inp1 = data.toString();
          const cont1 = inp1.split("\r\n");
          const num1 = parseInt(cont1[6]);
          console.log("replica sent ", num1, "propagated_commands jo hamne bheja ", length_of_propagated_commands);

          if (num1 === length_of_propagated_commands) {
            console.log("entered");
            if (!acknowledgedReplicas.has(replica)) {
              acknowledgedReplicas.add(replica);
              countOfReplicas++;
            }
          }
        });
      }

      checkTimeout();
    }
  }
});
server.listen(PORT, "0.0.0.0");
// Stream storage structure

// Stream storage structure

let check_for_block=1;
let blockingClients = new Map(); // Tracks blocking clients per stream

function handleXREADBLOCK(cont, conn) {
    const blockTime = parseInt(cont[6], 10); // Parse the block time in milliseconds
    const stream = cont[10]; // Stream name
    let startID = cont[12]; // Start ID

    if (!streammap.has(stream)) {
        streammap.set(stream, new Map());
    }

    const entries = streammap.get(stream);

    // Handle `$` as the start ID
    if (startID === "$") {
        if (entries.size === 0) {
            startID = "0-0"; // No entries yet, start from the beginning
        } else {
            // Use the last ID in the stream
            const lastEntry = Array.from(entries).pop();
            startID = lastEntry[0];
        }
    }

    const [startTimestamp, startSeq = "0"] = startID.split("-").map(Number);

    const pendingEntries = [];
    for (const [id, data] of entries) {
        const [entryTimestamp, entrySeq] = id.split("-").map(Number);
        if (
            entryTimestamp > startTimestamp ||
            (entryTimestamp === startTimestamp && entrySeq > startSeq)
        ) {
            pendingEntries.push({ id, data });
        }
    }

    if (pendingEntries.length > 0) {
        respondWithEntries(conn, stream, pendingEntries);
        return;
    }

    const clientInfo = { conn, stream, startTimestamp, startSeq };
    if (!blockingClients.has(stream)) {
        blockingClients.set(stream, []);
    }
    blockingClients.get(stream).push(clientInfo);

    if (blockTime > 0) {
        const timeout = setTimeout(() => {
            blockingClients.set(
                stream,
                blockingClients.get(stream).filter(c => c !== clientInfo)
            );
            conn.write("$-1\r\n"); // Null response on timeout
        }, blockTime);

        clientInfo.timeout = timeout;
    }
}

function handleXADD(cont, conn) {
    const stream = cont[4];
    let id = cont[6];
    let idParts;
    let idint, number;

    if (!prevstremtime) prevstremtime = 0;
    if (!prevstreamnum) prevstreamnum = 0;

    if (id === "*") {
        idint = Date.now();
        number = idint === prevstremtime ? prevstreamnum + 1 : 0;
        id = `${idint}-${number}`;
    } else {
        idParts = id.split("-");
        idint = parseInt(idParts[0]);
        number = idParts[1] === "*" ? -1 : parseInt(idParts[1]);

        if (number !== -1) {
            if (idint === 0 && number === 0) {
                conn.write("-ERR The ID specified in XADD must be greater than 0-0\r\n");
                return;
            }
            if (idint < prevstremtime || (idint === prevstremtime && number <= prevstreamnum)) {
                conn.write("-ERR The ID specified in XADD is equal or smaller than the target stream top item\r\n");
                return;
            }
        }

        if (number === -1) {
            if (idint === prevstremtime) {
                number = prevstreamnum + 1;
            } else if (idint > prevstremtime) {
                number = 0;
            } else {
                conn.write("-ERR The ID specified in XADD is equal or smaller than the target stream top item\r\n");
                return;
            }
            id = `${idint}-${number}`;
        }
    }

    if (!streammap.has(stream)) {
        streammap.set(stream, new Map());
    }

    const values = new Map();
    values.set(cont[8], cont[10]);

    streammap.get(stream).set(id, {
        ID: id,
        Values: values
    });

    prevstremtime = idint;
    prevstreamnum = number;

    conn.write(`$${id.length}\r\n${id}\r\n`);

    if (blockingClients.has(stream)) {
        const waitingClients = blockingClients.get(stream);
        const pendingClients = [];

        for (const client of waitingClients) {
            const { conn: clientConn, startTimestamp, startSeq, timeout } = client;
            if (idint > startTimestamp || (idint === startTimestamp && number > startSeq)) {
                respondWithEntries(clientConn, stream, [{ id, data: { ID: id, Values: values } }]);
                if (timeout) clearTimeout(timeout); // Clear timeout if it exists
            } else {
                pendingClients.push(client);
            }
        }

        blockingClients.set(stream, pendingClients);
    }
}

function respondWithEntries(conn, stream, entries) {
    const result = `*1\r\n*2\r\n$${stream.length}\r\n${stream}\r\n*${entries.length}\r\n${entries
        .map(({ id, data }) => {
            const values = Array.from(data.Values.entries()).flat();
            return `*2\r\n$${id.length}\r\n${id}\r\n*${values.length}\r\n${values
                .map(val => `$${val.length}\r\n${val}\r\n`)
                .join("")}`;
        })
        .join("")}`;
    conn.write(result);
}


function handleXRANGE(cont, conn) {
  const stream = cont[4];
  const start = cont[6];
  const end = cont[8];

  if (!streammap.has(stream)) {
      conn.write("*0\r\n");
      return;
  }

  const entries = streammap.get(stream);
  const [startTimestamp, startSeq = "0"] = start === "-" ? ["0", "0"] : start.split("-");
  const [endTimestamp, endSeq = "18446744073709551615"] = end === "+" 
      ? [Number.MAX_SAFE_INTEGER.toString(), "18446744073709551615"] 
      : end.split("-");

  const result = [];
  for (const [id, data] of entries) {
      const [entryTimestamp, entrySeq] = id.split("-").map(Number);

      if (
          (entryTimestamp > Number(startTimestamp) || 
           (entryTimestamp === Number(startTimestamp) && entrySeq >= Number(startSeq))) &&
          (entryTimestamp < Number(endTimestamp) || 
           (entryTimestamp === Number(endTimestamp) && entrySeq <= Number(endSeq)))
      ) {
          let resp = "*2\r\n";
          resp += `$${id.length}\r\n${id}\r\n`;

          const values = [];
          for (const [key, value] of data.Values.entries()) {
              values.push(key, value);
          }

          resp += `*${values.length}\r\n`;
          values.forEach(val => {
              resp += `$${val.length}\r\n${val}\r\n`;
          });

          result.push(resp);
      }
  }

  conn.write(`*${result.length}\r\n${result.join("")}`);
}


function handleXREAD(cont, conn) {
  const streams = [];
  const startIDs = [];

  // Parse the streams and their corresponding start IDs
  for (let i = 6; i < cont.length; i += 2) {
    if(streammap.has(cont[i]))
    {
      streams.push(cont[i]);
    }
    else
    startIDs.push(cont[i]);
  }//d

  const result = [];

  for (let i = 0; i < streams.length; i++) {
      const stream = streams[i];
      const startID = startIDs[i];

      if (!streammap.has(stream)) {
          continue; // Skip if the stream does not exist
      }

      const entries = streammap.get(stream);
      const [startTimestamp, startSeq = "0"] = startID.split("-").map(Number);

      const streamResult = [];
      for (const [id, data] of entries) {
          const [entryTimestamp, entrySeq] = id.split("-").map(Number);

          // XREAD is exclusive: only include entries with IDs greater than the provided ID
          if (
              entryTimestamp > startTimestamp ||
              (entryTimestamp === startTimestamp && entrySeq > startSeq)
          ) {
              let entryResp = "*2\r\n";
              entryResp += `$${id.length}\r\n${id}\r\n`;

              const values = [];
              for (const [key, value] of data.Values.entries()) {
                  values.push(key, value);
              }

              entryResp += `*${values.length}\r\n`;
              values.forEach(val => {
                  entryResp += `$${val.length}\r\n${val}\r\n`;
              });

              streamResult.push(entryResp);
          }
      }

      if (streamResult.length > 0) {
          let streamResp = `*2\r\n$${stream.length}\r\n${stream}\r\n*${streamResult.length}\r\n${streamResult.join("")}`;
          result.push(streamResp);
      }
  }

  if (result.length === 0) {
      conn.write("*0\r\n"); // RESP empty array if no data for any stream
      return;
  }

  let finalResponse = `*${result.length}\r\n${result.join("")}`;
  conn.write(finalResponse); // Send the RESP response
}
