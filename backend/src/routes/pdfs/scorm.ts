import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const JSZip = require('jszip') as new () => any;

import { db } from '../../db';
import type { PageRow, PdfRow } from '../../types';
import { safeJoinPdfPath, pageImagePath, pageAudioPath, pageScriptPath, pageTextPath } from '../../services/storage';
import { escapeXml } from '../../escapeXml';
import { decodeSession, parseCookies } from '../auth';
import { errorResponse, IdParamSchema } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

async function readFileSafe(absPath: string | null): Promise<Buffer | null> {
  if (!absPath) return null;
  try {
    return await fs.readFile(absPath);
  } catch {
    return null;
  }
}

async function readTextSafe(absPath: string | null): Promise<string> {
  if (!absPath) return '';
  try {
    return (await fs.readFile(absPath, 'utf-8')).trim();
  } catch {
    return '';
  }
}

function buildManifest(pdfId: string, title: string, pages: PageRow[], hasAudio: boolean[]): string {
  const escapedTitle = escapeXml(title);
  const fileEntries: string[] = ['<file href="index.html"/>'];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const dir = `pages/page_${String(p.page_number).padStart(3, '0')}`;
    const hasImg = !!p.image_path;
    if (hasImg) fileEntries.push(`<file href="${dir}/image.jpg"/>`);
    if (hasAudio[i]) fileEntries.push(`<file href="${dir}/audio.mp3"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="makeslide-${escapeXml(pdfId)}" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>${escapedTitle}</title>
      <item identifier="item1" identifierref="resource1">
        <title>${escapedTitle}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="resource1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      ${fileEntries.join('\n      ')}
    </resource>
  </resources>
</manifest>`;
}

function buildIndexHtml(title: string, pages: PageRow[], scripts: string[]): string {
  const escapedTitle = escapeXml(title);

  const slidesJson = JSON.stringify(
    pages.map((p, i) => ({
      n: p.page_number,
      img: `pages/page_${String(p.page_number).padStart(3, '0')}/image.jpg`,
      audio: p.audio_path ? `pages/page_${String(p.page_number).padStart(3, '0')}/audio.mp3` : null,
      script: scripts[i] || '',
    })),
  );

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapedTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1a2e; color: #e0e0e0; font-family: sans-serif; height: 100vh; display: flex; flex-direction: column; }
    #slide-area { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    #slide-img { max-width: 100%; max-height: 100%; object-fit: contain; }
    #controls { padding: 8px 16px; background: #16213e; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    button { background: #0f3460; color: #e0e0e0; border: 1px solid #e94560; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 14px; }
    button:disabled { opacity: 0.4; cursor: default; }
    #page-counter { font-size: 14px; min-width: 80px; text-align: center; }
    #script-area { max-height: 80px; overflow-y: auto; font-size: 13px; color: #aaa; padding: 4px 16px; background: #0d0d1a; }
    #progress-bar { height: 4px; background: #e94560; transition: width 0.3s; }
  </style>
</head>
<body>
<div id="slide-area"><img id="slide-img" src="" alt=""/></div>
<div id="controls">
  <button id="btn-prev" onclick="prevSlide()">&#9664; 上一頁</button>
  <span id="page-counter">1 / 1</span>
  <button id="btn-next" onclick="nextSlide()">下一頁 &#9654;</button>
  <audio id="audio-player" controls style="height:32px;flex:1;min-width:180px;"></audio>
</div>
<div id="progress-bar" style="width:0%"></div>
<div id="script-area"></div>
<script>
var slides = ${slidesJson};
var current = 0;
var scormApi = null;

function findScormApi(win) {
  if (!win) return null;
  if (win.API) return win.API;
  if (win.parent && win.parent !== win) return findScormApi(win.parent);
  return null;
}

function initScorm() {
  scormApi = findScormApi(window);
  if (scormApi) {
    scormApi.LMSInitialize('');
    scormApi.LMSSetValue('cmi.core.lesson_status', 'incomplete');
  }
}

function finishScorm() {
  if (scormApi) {
    scormApi.LMSSetValue('cmi.core.lesson_status', 'completed');
    scormApi.LMSSetValue('cmi.core.score.raw', '100');
    scormApi.LMSSetValue('cmi.core.score.min', '0');
    scormApi.LMSSetValue('cmi.core.score.max', '100');
    scormApi.LMSCommit('');
    scormApi.LMSFinish('');
  }
}

function renderSlide() {
  var s = slides[current];
  var img = document.getElementById('slide-img');
  img.src = s.img;
  img.alt = '第 ' + s.n + ' 頁';

  var audio = document.getElementById('audio-player');
  if (s.audio) {
    audio.src = s.audio;
    audio.style.display = '';
  } else {
    audio.src = '';
    audio.style.display = 'none';
  }

  document.getElementById('script-area').textContent = s.script || '';
  document.getElementById('page-counter').textContent = (current + 1) + ' / ' + slides.length;
  document.getElementById('btn-prev').disabled = current === 0;
  document.getElementById('btn-next').disabled = current === slides.length - 1;
  document.getElementById('progress-bar').style.width = ((current + 1) / slides.length * 100) + '%';

  if (scormApi) {
    scormApi.LMSSetValue('cmi.core.lesson_location', String(current + 1));
    scormApi.LMSCommit('');
  }
  if (current === slides.length - 1) finishScorm();
}

function prevSlide() { if (current > 0) { current--; renderSlide(); } }
function nextSlide() { if (current < slides.length - 1) { current++; renderSlide(); } }

document.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextSlide();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevSlide();
});

initScorm();
if (slides.length > 0) renderSlide();
</script>
</body>
</html>`;
}

export async function registerScormRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/export.scorm', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));

    const { id } = parsed.data;
    const pdfRow = db
      .prepare(`SELECT id, title, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as Pick<PdfRow, 'id' | 'title' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限匯出此簡報'));
    }

    const pages = db
      .prepare(
        `SELECT pdf_id, page_number, page_uid, image_path, audio_path, script_path, text_path,
                audio_duration_seconds, status, error_message, created_at, updated_at
           FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(id) as PageRow[];

    if (pages.length === 0) return reply.code(400).send(errorResponse('NO_PAGES', 'No pages available'));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const zip = new JSZip();

    const hasAudio: boolean[] = [];
    const scripts: string[] = [];

    for (const page of pages) {
      const dir = `pages/page_${String(page.page_number).padStart(3, '0')}`;

      // Image
      const imgAbs = page.image_path ? safeJoinPdfPath(id, page.image_path) : null;
      const imgBuf = await readFileSafe(imgAbs);
      if (imgBuf) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        zip.folder(dir)?.file('image.jpg', imgBuf);
      }

      // Audio
      const audioAbs = page.audio_path ? safeJoinPdfPath(id, page.audio_path) : pageAudioPath(id, page.page_uid);
      const audioBuf = await readFileSafe(audioAbs);
      if (audioBuf) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        zip.folder(dir)?.file('audio.mp3', audioBuf);
        hasAudio.push(true);
      } else {
        hasAudio.push(false);
      }

      // Script / transcript
      const scriptAbs = page.script_path ? safeJoinPdfPath(id, page.script_path) : pageScriptPath(id, page.page_uid);
      const textAbs = page.text_path ? safeJoinPdfPath(id, page.text_path) : pageTextPath(id, page.page_uid);
      const script = (await readTextSafe(scriptAbs)) || (await readTextSafe(textAbs));
      scripts.push(script);
    }

    const title = pdfRow.title ?? id;
    const manifest = buildManifest(id, title, pages, hasAudio);
    const indexHtml = buildIndexHtml(title, pages, scripts);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    zip.file('imsmanifest.xml', manifest);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    zip.file('index.html', indexHtml);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const safeName = title.trim().replace(/[^A-Za-z0-9一-鿿._-]+/g, '_') || 'makeslide';
    void reply.header('Content-Type', 'application/zip');
    void reply.header('Content-Disposition', `attachment; filename="${safeName}.scorm.zip"`);
    return reply.send(zipBuffer);
  });
}
