const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const GENERATED = path.join(ROOT, 'generated');
const COMFY_URL = 'http://127.0.0.1:8188';
fs.mkdirSync(GENERATED, { recursive: true });

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim().startsWith('#') && line.includes('=')) {
      const [key, ...rest] = line.split('=');
      if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
    }
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status}: ${data.error?.message || data.error || text}`);
  return data;
}

async function uploadToComfy(filePath) {
  const form = new FormData();
  const bytes = fs.readFileSync(filePath);
  form.append('image', new Blob([bytes]), path.basename(filePath));
  form.append('overwrite', 'true');
  return jsonFetch(`${COMFY_URL}/upload/image`, { method: 'POST', body: form });
}

async function create3d(filePath) {
  const uploaded = await uploadToComfy(filePath);
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflow_api.json'), 'utf8'));
  workflow['2'].inputs.image = [uploaded.subfolder, uploaded.name].filter(Boolean).join('/');
  const queued = await jsonFetch(`${COMFY_URL}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }) });
  if (!queued.prompt_id) throw new Error('ComfyUI did not return a prompt id.');
  const timeout = Date.now() + 15 * 60 * 1000;
  while (Date.now() < timeout) {
    const history = await jsonFetch(`${COMFY_URL}/history/${queued.prompt_id}`);
    const job = history[queued.prompt_id];
    if (job?.status?.status_str === 'error') throw new Error('ComfyUI workflow failed. Check the ComfyUI terminal.');
    const output = job?.outputs?.['10'] || {};
    for (const key of ['3d', 'gltf', 'glb', 'files']) if (output[key]?.length) return output[key][0];
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Timed out waiting for Hunyuan3D (15 minutes).');
}

function respond(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function body(req) { return new Promise((resolve, reject) => { const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
function parseImageUpload(data, contentType) {
  const match = /boundary=(.+)$/i.exec(contentType || '');
  if (!match) throw new Error('Expected a multipart image upload.');
  const boundary = Buffer.from(`--${match[1].replaceAll('"', '')}`);
  const start = data.indexOf(boundary);
  const headerEnd = data.indexOf(Buffer.from('\r\n\r\n'), start);
  const header = data.slice(start, headerEnd).toString('utf8');
  const filename = /filename="([^\"]+)"/i.exec(header)?.[1];
  if (!filename) throw new Error('No image file was received.');
  const fileStart = headerEnd + 4;
  const fileEnd = data.indexOf(Buffer.from('\r\n--'), fileStart);
  return { filename: path.basename(filename), data: data.slice(fileStart, fileEnd) };
}

const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:5173');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      let comfy = false; try { await jsonFetch(`${COMFY_URL}/system_stats`); comfy = true; } catch {}
      return respond(res, 200, { comfy, openai: Boolean(process.env.OPENAI_API_KEY) });
    }
    if (req.method === 'GET' && url.pathname === '/api/download') {
      const params = new URLSearchParams(); for (const key of ['filename','subfolder','type']) if (url.searchParams.has(key)) params.set(key, url.searchParams.get(key));
      const remote = await fetch(`${COMFY_URL}/view?${params}`); if (!remote.ok) throw new Error(`ComfyUI file download failed: ${remote.status}`);
      const bytes = Buffer.from(await remote.arrayBuffer());
      res.writeHead(200, { 'Content-Type': remote.headers.get('content-type') || 'model/gltf-binary', 'Content-Disposition': 'attachment; filename="model.glb"', 'Content-Length': bytes.length }); return res.end(bytes);
    }
    if (req.method === 'POST' && url.pathname === '/api/generate-image') {
      const { messages = [] } = JSON.parse((await body(req)).toString('utf8'));
      if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY. Add it to .env, then restart the server.');
      const chat = messages.filter(message => message?.role && message?.content).slice(-12);
      if (!chat.length || !chat.some(message => message.role === 'user')) throw new Error('Please send a message first.');
      const transcript = chat.map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`).join('\n');
      const promptReply = await jsonFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-5.6-luna',
          messages: [
            { role: 'system', content: 'You are a friendly Traditional Chinese creative assistant. Read the complete conversation and generate an updated concept image from the user\'s newest request. Reply in exactly this format, with no markdown: REPLY: <one short Traditional Chinese sentence telling the user what you changed or generated>\nPROMPT: <one concise English image prompt>. The image prompt must depict one complete 3D-friendly object, centered, isolated on a light neutral studio background, with a clear silhouette. Never include text, logos, watermarks, people, multiple objects, a collage, or an image border.' },
            { role: 'user', content: transcript }
          ]
        })
      });
      const combined = promptReply.choices?.[0]?.message?.content?.trim() || '';
      const sections = /^REPLY:\s*([\s\S]*?)\nPROMPT:\s*([\s\S]*)$/i.exec(combined);
      const assistant = sections?.[1]?.trim() || '已依照你的最新需求生成一張新圖片。';
      const imagePrompt = sections?.[2]?.trim() || combined;
      if (!imagePrompt) throw new Error('GPT did not return an image prompt.');
      const result = await jsonFetch('https://api.openai.com/v1/images/generations', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`}, body:JSON.stringify({model:'gpt-image-2',prompt:imagePrompt,size:'1024x1024',quality:'medium'}) });
      const image = result.data?.[0]; let bytes;
      if (image?.b64_json) bytes = Buffer.from(image.b64_json, 'base64');
      else if (image?.url) { const response = await fetch(image.url); bytes = Buffer.from(await response.arrayBuffer()); }
      else throw new Error('OpenAI returned no image data.');
      const name = `gpt-${crypto.randomUUID().slice(0,12)}.png`; fs.writeFileSync(path.join(GENERATED,name),bytes);
      return respond(res,200,{file:name,url:`/generated/${name}`,imagePrompt,assistant});
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const upload = parseImageUpload(await body(req), req.headers['content-type']);
      const ext = path.extname(upload.filename).toLowerCase(); if (!['.png','.jpg','.jpeg','.webp'].includes(ext)) throw new Error('Use PNG, JPG, JPEG, or WEBP.');
      const name = `upload-${crypto.randomUUID().slice(0,12)}${ext}`; fs.writeFileSync(path.join(GENERATED,name),upload.data);
      return respond(res,200,{file:name,url:`/generated/${name}`});
    }
    if (req.method === 'POST' && url.pathname === '/api/create-3d') {
      const { file = '' } = JSON.parse((await body(req)).toString('utf8')); const safe = path.basename(file); const source = path.join(GENERATED,safe);
      if (!fs.existsSync(source)) throw new Error('Image not found. Generate or upload it again.');
      const output = await create3d(source); const download = new URLSearchParams({filename:output.filename || '',subfolder:output.subfolder || '',type:output.type || 'output'});
      return respond(res,200,{download:`/api/download?${download}`});
    }
    if (req.method === 'GET') {
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.resolve(ROOT, `.${requested}`); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      const bytes = fs.readFileSync(file); res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream','Content-Length':bytes.length}); return res.end(bytes);
    }
    respond(res,404,{error:'Not found'});
  } catch (error) { respond(res,500,{error:error.message || String(error)}); }
});
server.listen(5173,'127.0.0.1',() => console.log('Chat 3D Tool: http://127.0.0.1:5173'));
