// Leave all real clipboard implementations intact. Deny outbound Node networking.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const denied = () => { throw new Error('Acceptance fixture forbids network access'); };
net.Socket.prototype.connect = denied;
net.connect = net.createConnection = tls.connect = denied;
http.request = http.get = https.request = https.get = denied;
dgram.createSocket = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
