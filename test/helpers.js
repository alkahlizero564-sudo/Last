import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// كل اختبار يعمل في مجلد بيانات مؤقت ومعزول
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apkf-test-'));
for (const k of Object.keys(process.env)) if (/API_KEY|TOKEN|GITHUB_|SUPABASE_|GMAIL|BREVO|ADMIN_PASSWORD/.test(k)) delete process.env[k];
