import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { Server } from '@modelcontextprotocol/server';
import { getEnterpriseRequestContext, withEnterpriseRequestContext } from './enterprise-request-context.js';
import { startMcpHttpApi, type McpHttpHandle } from './mcp-http.js';
import { loadOwnerMtlsBindings } from './owner-activity-mtls.js';
import { loadReviewedSkillsHost } from './skill-release-host.js';

const producer = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@modelcontextprotocol/server', () => ({
  createMcpHandler: () => ({ fetch: producer.fetch, close: async () => {} }),
}));
vi.mock('./createServer.js', () => ({
  getServerRuntime: () => ({ createRequestServer: () => ({}) }),
}));

const apis: McpHttpHandle[] = [];
afterEach(async () => {
  for (const api of apis.splice(0)) {
    api.server.closeAllConnections();
    await api.close();
  }
  producer.fetch.mockReset();
});

function serve(options: Parameters<typeof startMcpHttpApi>[1] = {}) {
  return startMcpHttpApi({} as Server, { port: 0, ...options }).then(api => {
    apis.push(api);
    return api;
  });
}

function tlsRequest(port: number, options: { ca: Buffer; cert?: Buffer; key?: Buffer }, body='{}') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpsRequest({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', servername: 'localhost',
      ca: options.ca, cert: options.cert, key: options.key, headers: { host: '127.0.0.1', 'content-type': 'application/json' } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

function httpRequestWithHeaders(port: number, headers: Record<string, string>, body = '{}') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

async function certificates() {
  const directory = await mkdtemp(join(tmpdir(), 'mcpvault-enterprise-tls-'));
  const config = join(directory, 'openssl.cnf');
  await writeFile(config, '[ req ]\ndistinguished_name = subject\n[ subject ]\n', 'utf8');
  const run = (...args: string[]) => execFileSync('openssl.exe', args, { cwd: directory, stdio: 'ignore', env: { ...process.env, OPENSSL_CONF: config } });
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=test-ca', '-days', '1');
  for (const name of ['server', 'client', 'wrong']) {
    run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name === 'server' ? 'localhost' : name}`);
    if (name === 'wrong') run('x509', '-req', '-in', `${name}.csr`, '-signkey', `${name}.key`, '-out', `${name}.crt`, '-days', '1');
    else run('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.crt`, '-days', '1');
  }
  const read = (name: string) => readFile(join(directory, name));
  return {
    directory,
    ca: await read('ca.crt'), serverCert: await read('server.crt'), serverKey: await read('server.key'),
    clientCert: await read('client.crt'), clientKey: await read('client.key'), wrongCert: await read('wrong.crt'), wrongKey: await read('wrong.key'),
  };
}

test('request context survives asynchronous work without leaking to a concurrent request', async () => {
  const [first, second] = await Promise.all([
    withEnterpriseRequestContext({ transport: 'http', certFingerprint: 'a'.repeat(64) }, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return getEnterpriseRequestContext();
    }),
    withEnterpriseRequestContext({ transport: 'rest' }, async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return getEnterpriseRequestContext();
    }),
  ]);

  expect(first).toEqual({ transport: 'http', certFingerprint: 'a'.repeat(64) });
  expect(second).toEqual({ transport: 'rest' });
  expect(getEnterpriseRequestContext()).toBeUndefined();
});

test('HTTP dispatch keeps concurrent trusted contexts separate and ignores client fingerprint headers', async () => {
  producer.fetch.mockImplementation(async request => {
    await new Promise(resolve => setTimeout(resolve, request.headers.get('x-request-id') === 'first' ? 5 : 1));
    return new Response(JSON.stringify(getEnterpriseRequestContext()));
  });
  const api = await serve();
  const invoke = (requestId: string, fakeFingerprint: string) => fetch(`http://127.0.0.1:${api.port}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-client-cert-fingerprint': fakeFingerprint }, body: '{}',
  }).then(response => response.json());
  const [first, second] = await Promise.all([invoke('first', 'a'.repeat(64)), invoke('second', 'b'.repeat(64))]);
  expect(first).toEqual({ transport: 'http' });
  expect(second).toEqual({ transport: 'http' });
});

test('HTTP origin, host, and body limits still reject requests before dispatch', async () => {
  producer.fetch.mockResolvedValue(new Response('dispatched'));
  const api = await serve({ allowedOrigins: ['https://approved.example'], allowedHosts: ['approved.example'], maxBodyBytes: 1024 });
  const rejectedOrigin = await httpRequestWithHeaders(api.port, { host: 'approved.example', origin: 'https://untrusted.example', 'content-type': 'application/json' });
  const rejectedHost = await httpRequestWithHeaders(api.port, { host: 'untrusted.example', 'content-type': 'application/json' });
  const rejectedBody = await httpRequestWithHeaders(api.port, { host: 'approved.example', 'content-type': 'application/json' }, 'x'.repeat(1025));
  expect(rejectedOrigin.status).toBe(403);
  expect(rejectedHost.status).toBe(400);
  expect(rejectedBody.status).toBe(400);
  expect(producer.fetch).not.toHaveBeenCalled();
});

test('required mTLS refuses incomplete configuration and unverified peer certificates before dispatch', async () => {
  await expect(serve({ requireClientCertificate: true } as any)).rejects.toThrow('requires TLS with a CA');
  await expect(serve({ requireClientCertificate: true, tls: { key: 'key', cert: 'cert' } } as any)).rejects.toThrow('requires TLS with a CA');

  const fixtures = await certificates();
  try {
    producer.fetch.mockImplementation(async () => new Response(JSON.stringify(getEnterpriseRequestContext())));
    const api = await serve({ requireClientCertificate: true, tls: { key: fixtures.serverKey, cert: fixtures.serverCert, ca: fixtures.ca } } as any);
    await expect(tlsRequest(api.port, { ca: fixtures.ca })).rejects.toBeInstanceOf(Error);
    await expect(tlsRequest(api.port, { ca: fixtures.ca, cert: fixtures.wrongCert, key: fixtures.wrongKey })).rejects.toBeInstanceOf(Error);
    expect(producer.fetch).not.toHaveBeenCalled();
    const accepted = await tlsRequest(api.port, { ca: fixtures.ca, cert: fixtures.clientCert, key: fixtures.clientKey });
    expect(accepted.status).toBe(200);
    expect(JSON.parse(accepted.body)).toEqual({ transport: 'http', certFingerprint: new X509Certificate(fixtures.clientCert).fingerprint256.replaceAll(':', '').toLowerCase() });
  } finally {
    await rm(fixtures.directory, { recursive: true, force: true });
  }
}, 20_000);

test('host consent binding uses the real verified TLS peer and drops a revoked mapping',async()=>{
  const fixtures=await certificates();
  try{
    const vault=join(fixtures.directory,'vault'),host=join(fixtures.directory,'host');await mkdir(vault);await mkdir(host,{mode:0o700});
    if(process.platform==='win32')execFileSync('icacls.exe',[host,'/inheritance:r','/grant:r',`${userInfo().username}:(OI)(CI)F`],{windowsHide:true,stdio:'ignore'});
    const path=join(host,'clients.json'),fingerprint=new X509Certificate(fixtures.clientCert).fingerprint256.replaceAll(':','').toLowerCase();
    const definition={version:1,vaultPath:vault,bindings:[{accountId:'operator',executionTarget:'host-reader',certFingerprint:fingerprint,expiresAt:'2999-01-01T00:00:00.000Z'}]};
    await writeFile(path,JSON.stringify(definition),{mode:0o600});
    const binding=await loadOwnerMtlsBindings(path,vault);
    // Auth is a supplied fixture here; full account/service tests are separate.
    producer.fetch.mockImplementation(async()=>new Response(JSON.stringify(binding.execution({accountId:'operator',modelId:'test',role:'model',capabilities:[]})??null)));
    const api=await serve({requireClientCertificate:true,tls:{key:fixtures.serverKey,cert:fixtures.serverCert,ca:fixtures.ca}});
    const accepted=await tlsRequest(api.port,{ca:fixtures.ca,cert:fixtures.clientCert,key:fixtures.clientKey});
    expect(JSON.parse(accepted.body)).toEqual({accountId:'operator',executionTarget:'host-reader'});
    await writeFile(path,JSON.stringify({...definition,bindings:[]}));await binding.refresh();
    const revoked=await tlsRequest(api.port,{ca:fixtures.ca,cert:fixtures.clientCert,key:fixtures.clientKey});expect(JSON.parse(revoked.body)).toBeNull();
  }finally{await rm(fixtures.directory,{recursive:true,force:true});}
},20_000);

test('reviewed-only listener rejects unrelated calls and mixed batches before the shared dispatcher',async()=>{
  await expect(serve({requestProfile:'reviewed-skill-read'} as any)).rejects.toThrow('requires loopback and mandatory mTLS');
  await expect(serve({requestProfile:'unrestricted'} as any)).rejects.toThrow('requires loopback and mandatory mTLS');
  const fixtures=await certificates();
  try{
    producer.fetch.mockImplementation(async()=>new Response('allowed read route'));
    const api=await serve({requireClientCertificate:true,requestProfile:'reviewed-skill-read',tls:{key:fixtures.serverKey,cert:fixtures.serverCert,ca:fixtures.ca}} as any);
    const peer={ca:fixtures.ca,cert:fixtures.clientCert,key:fixtures.clientKey};
    const rpc=(arguments_:Record<string,unknown>,name='call_endpoint')=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:arguments_}});
    const read=rpc({endpointId:'skill.resolve',arguments:{skillId:'test-skill',view:'metadata'}});
    expect((await tlsRequest(api.port,peer,JSON.stringify(read))).status).toBe(200);
    producer.fetch.mockClear();
    const denied=[rpc({endpointId:'notes.write',arguments:{path:'test.md',content:'must not dispatch'}}),
      rpc({endpointId:'auth.register',arguments:{accountId:'another'}}),rpc({endpointId:'auth.login',arguments:{accountId:'another'}}),
      rpc({url:'/api/notes/test',method:'POST'}),rpc({endpointId:'skill.resolve',url:'/api/notes/test'}),
      rpc({path:'test.md',content:'no'},'write_note'),rpc({},'orient_wiki'),
      [read,rpc({endpointId:'notes.write',arguments:{}})]];
    for(const body of denied)expect((await tlsRequest(api.port,peer,JSON.stringify(body))).status).toBe(403);
    expect(producer.fetch).not.toHaveBeenCalled();
  }finally{await rm(fixtures.directory,{recursive:true,force:true});}
},20_000);

test('reviewed host configuration drives real private mTLS and denies removed owner consent',async()=>{
  const fixtures=await certificates();let host:Awaited<ReturnType<typeof loadReviewedSkillsHost>>|undefined;
  try{
    const vaultPath=join(fixtures.directory,'reviewed-vault'),hostPath=join(fixtures.directory,'reviewed-host');
    await mkdir(vaultPath);await mkdir(hostPath,{mode:0o700});
    if(process.platform==='win32')execFileSync('icacls.exe',[hostPath,'/inheritance:r','/grant:r',`${userInfo().username}:(OI)(CI)F`],{windowsHide:true,stdio:'ignore'});
    for(const name of ['entries','blobs','receipts'])await mkdir(join(hostPath,name),{mode:0o700});
    const certPath=join(hostPath,'cert.pem'),keyPath=join(hostPath,'key.pem'),caPath=join(hostPath,'ca.pem');
    for(const [path,bytes] of [[certPath,fixtures.serverCert],[keyPath,fixtures.serverKey],[caPath,fixtures.ca]] as const)await writeFile(path,bytes,{mode:0o600});
    const ownerPolicyPath=join(hostPath,'owner.json'),bindingsPath=join(hostPath,'bindings.json'),configPath=join(hostPath,'config.json');
    const owner={version:1,vaultPath,owners:{operator:'owner'},grants:[{id:'read',ownerId:'owner',accountIds:['operator'],activities:['skill-evolution'],actions:['read','discover'],dataPrefixes:['Community/Skills'],executionTargets:['verified-host'],expiresAt:'2999-01-01T00:00:00.000Z'}]};
    await writeFile(ownerPolicyPath,JSON.stringify(owner),{mode:0o600});
    await writeFile(bindingsPath,JSON.stringify({version:1,vaultPath,bindings:[{accountId:'operator',executionTarget:'verified-host',certFingerprint:new X509Certificate(fixtures.clientCert).fingerprint256.replaceAll(':','').toLowerCase(),expiresAt:'2999-01-01T00:00:00.000Z'}]}),{mode:0o600});
    await writeFile(configPath,JSON.stringify({version:1,vaultPath,hostPath,ownerPolicyPath,bindingsPath,listener:{port:0,certPath,keyPath,caPath}}),{mode:0o600});
    host=await loadReviewedSkillsHost(configPath,vaultPath);const runtime=host;
    // Real private file ACL and CA verification; the principal remains a fixture.
    producer.fetch.mockImplementation(async()=>{
      await runtime.ownerActivity.refresh();const execution=runtime.ownerActivity.execution({accountId:'operator',modelId:'test',role:'model',capabilities:[]});
      const allowed=!!execution&&runtime.ownerActivity.policy().decision({...execution,activity:'skill-evolution',action:'read',paths:['Community/Skills/test/SKILL.md'],now:Date.now()}).allowed;
      return new Response(JSON.stringify({allowed}));
    });
    const api=await serve(host.listener);
    const readRequest=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'call_endpoint',arguments:{endpointId:'skill.resolve',arguments:{skillId:'test'}}}});
    await expect(tlsRequest(api.port,{ca:fixtures.ca})).rejects.toBeInstanceOf(Error);expect(producer.fetch).not.toHaveBeenCalled();
    expect(JSON.parse((await tlsRequest(api.port,{ca:fixtures.ca,cert:fixtures.clientCert,key:fixtures.clientKey},readRequest)).body)).toEqual({allowed:true});
    await writeFile(ownerPolicyPath,JSON.stringify({...owner,grants:[]}));
    expect(JSON.parse((await tlsRequest(api.port,{ca:fixtures.ca,cert:fixtures.clientCert,key:fixtures.clientKey},readRequest)).body)).toEqual({allowed:false});
  }finally{host?.close();await rm(fixtures.directory,{recursive:true,force:true});}
},30_000);
