/**
 * 將既有簡報的擁有者（owner_sub）轉移到指定帳號下。
 *
 * 多帳號設計中，簡報是以登入者的 Google `sub`（OpenID Connect 的使用者識別碼）
 * 記錄在 pdfs.owner_sub 欄位中；尚未指定擁有者的簡報該欄位為 NULL。
 * 要找出目標帳號的 sub，請用該 Google 帳號登入後呼叫 `/api/auth/status`，
 * 回傳的 `user.sub` 即為這裡需要的值。
 *
 * 用法：
 *   npm run script:assign-owner -- --owner-sub <sub> [--ids id1,id2,...] [--visibility private|public|public_editable] [--dry-run]
 *
 * 範例：
 *   # 把目前所有「尚未有擁有者」的簡報都轉移到指定帳號下
 *   npm run script:assign-owner -- --owner-sub 1234567890
 *
 *   # 只轉移指定的幾份簡報
 *   npm run script:assign-owner -- --owner-sub 1234567890 --ids 2euPAt7Al5,gbG4UtZsTp
 *
 *   # 先看看會變更哪些簡報，不實際寫入
 *   npm run script:assign-owner -- --owner-sub 1234567890 --dry-run
 */
import { db } from '../db';
import { logger } from '../logger';

interface CliOptions {
  ownerSub: string;
  ids: string[] | null;
  visibility: 'private' | 'public' | 'public_editable' | null;
  dryRun: boolean;
}

function printUsageAndExit(message?: string): never {
  if (message) {
    console.error(`錯誤：${message}\n`);
  }
  console.error(
    [
      '用法：',
      '  npm run script:assign-owner -- --owner-sub <sub> [--ids id1,id2,...] [--visibility private|public|public_editable] [--dry-run]',
      '',
      '參數：',
      '  --owner-sub <sub>   必填。目標帳號的 Google sub（登入該帳號後可由 /api/auth/status 的 user.sub 取得）',
      '  --ids <id1,id2,..>  選填。只轉移指定的簡報 id；省略時預設轉移所有「尚未有擁有者」的簡報',
      '  --visibility <v>    選填。同時將這些簡報的可見性改為 private / public / public_editable',
      '  --dry-run           只顯示會變更的內容，不實際寫入資料庫',
    ].join('\n'),
  );
  process.exit(message ? 1 : 0);
}

function parseArgs(argv: string[]): CliOptions {
  let ownerSub: string | null = null;
  let ids: string[] | null = null;
  let visibility: CliOptions['visibility'] = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--owner-sub':
        ownerSub = argv[++i] ?? null;
        break;
      case '--ids':
        ids = (argv[++i] ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        break;
      case '--visibility': {
        const value = argv[++i];
        if (value !== 'private' && value !== 'public' && value !== 'public_editable') {
          printUsageAndExit(`--visibility 的值必須是 private / public / public_editable，收到 "${value}"`);
        }
        visibility = value;
        break;
      }
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsageAndExit();
        break;
      default:
        printUsageAndExit(`不認得的參數：${arg}`);
    }
  }

  if (!ownerSub || !ownerSub.trim()) {
    printUsageAndExit('請用 --owner-sub 指定目標帳號的 Google sub');
  }
  if (ids && ids.length === 0) {
    printUsageAndExit('--ids 需要至少一個簡報 id');
  }

  return { ownerSub: ownerSub.trim(), ids, visibility, dryRun };
}

interface TargetRow {
  id: string;
  title: string | null;
  owner_sub: string | null;
  visibility: 'private' | 'public' | 'public_editable';
}

function loadTargets(options: CliOptions): TargetRow[] {
  if (options.ids) {
    const placeholders = options.ids.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT id, title, owner_sub, visibility FROM pdfs WHERE id IN (${placeholders})`)
      .all(...options.ids) as TargetRow[];
    const found = new Set(rows.map((row) => row.id));
    const missing = options.ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      printUsageAndExit(`找不到下列簡報 id：${missing.join(', ')}`);
    }
    return rows;
  }

  return db
    .prepare(`SELECT id, title, owner_sub, visibility FROM pdfs WHERE owner_sub IS NULL OR owner_sub = ''`)
    .all() as TargetRow[];
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const targets = loadTargets(options);

  if (targets.length === 0) {
    console.log('沒有符合條件的簡報需要轉移。');
    return;
  }

  console.log(
    `${options.dryRun ? '[dry-run] ' : ''}將把以下 ${targets.length} 份簡報的擁有者設定為 owner_sub = ${options.ownerSub}` +
      (options.visibility ? `，並將可見性設定為 ${options.visibility}` : ''),
  );
  for (const row of targets) {
    const ownerDesc = row.owner_sub ? `owner_sub=${row.owner_sub}` : '（無擁有者）';
    console.log(`  - ${row.id}  ${row.title ?? '(無標題)'}  [${ownerDesc}, visibility=${row.visibility}]`);
  }

  if (options.dryRun) {
    console.log('\n[dry-run] 未寫入任何變更。移除 --dry-run 以實際套用。');
    return;
  }

  const now = new Date().toISOString();
  const update = options.visibility
    ? db.prepare(`UPDATE pdfs SET owner_sub = ?, visibility = ?, updated_at = ? WHERE id = ?`)
    : db.prepare(`UPDATE pdfs SET owner_sub = ?, updated_at = ? WHERE id = ?`);

  const applyAll = db.transaction((rows: TargetRow[]) => {
    for (const row of rows) {
      if (options.visibility) {
        update.run(options.ownerSub, options.visibility, now, row.id);
      } else {
        update.run(options.ownerSub, now, row.id);
      }
    }
  });
  applyAll(targets);

  logger.info(
    { ownerSub: options.ownerSub, visibility: options.visibility, count: targets.length, ids: targets.map((row) => row.id) },
    'Reassigned presentation ownership',
  );
  console.log(`\n完成，已將 ${targets.length} 份簡報轉移到帳號 ${options.ownerSub} 下。`);
}

main();
