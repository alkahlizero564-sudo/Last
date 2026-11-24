// تعليمات الذكاء الاصطناعي: خطة المشروع، توليد كل تطبيق، والتعديل.
import { configPath, ids, configFile } from '../stacks.js';

const FORMAT = `OUTPUT FORMAT (mandatory). Output every file like this, nothing else between files:
=== FILE: relative/path.ext ===
<full file content, no markdown fences>
=== END FILE ===
Always output COMPLETE file contents (never "...rest unchanged"). Do not output any file you were told not to write.`;

const STACK_RULES = {
  html: (p, a) => `Stack: plain HTML/CSS/JavaScript (no build step), packaged into an APK with Capacitor.
- All files live under www/. Entry: www/index.html. Use relative paths (e.g. "style.css", "app.js").
- www/config.js already exists (do NOT write it). Load it with <script src="config.js"></script> BEFORE your own scripts; it defines window.APP_CONFIG.
- Supabase: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> then window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey).
- Firebase Realtime Database: use its REST API (fetch(APP_CONFIG.firebaseDbUrl + '/path.json')) and EventSource on the same URL for realtime updates.
- No other external libraries unless loaded from a CDN with a pinned version.`,
  react: () => `Stack: React 18 + Vite, packaged into an APK with Capacitor.
- Write: index.html (with <div id="root"></div> and <script type="module" src="/src/main.jsx"></script>), src/main.jsx, src/App.jsx, and more components under src/ (.jsx). Styles: plain .css files imported from JS (import './App.css').
- src/config.js already exists (do NOT write it): import config from './config.js' -> { backend, supabaseUrl, supabaseAnonKey, firebaseDbUrl, firebaseApiKey }.
- Allowed npm packages ONLY: react, react-dom, @supabase/supabase-js. Do NOT write package.json or vite.config.js. No TypeScript, no router library (implement simple state-based navigation).
- Firebase Realtime Database: use REST via fetch + EventSource for realtime.`,
  flutter: (p, a) => `Stack: Flutter (Dart 3, Material 3), built with "flutter build apk".
- Write lib/main.dart and any other files under lib/. Write pubspec.yaml with name: ${ids(p, a).dartName}, sdk '>=3.3.0 <4.0.0', uses-material-design: true.
- Allowed dependencies ONLY: http, supabase_flutter, shared_preferences, intl (use recent caret versions, e.g. http: ^1.2.2, supabase_flutter: ^2.8.0, shared_preferences: ^2.3.2, intl: ^0.19.0).
- lib/config.dart already exists (do NOT write it): class AppConfig with static const String backend, supabaseUrl, supabaseAnonKey, firebaseDbUrl, firebaseApiKey.
- Supabase: await Supabase.initialize(url: AppConfig.supabaseUrl, anonKey: AppConfig.supabaseAnonKey) in main(). Firebase RTDB: REST with package:http (and polling or streaming for realtime).
- Do NOT write android/ or test/ files.`,
  kotlin: (p, a) => `Stack: native Kotlin Android app with Jetpack Compose (Material 3), single Activity. Package: ${ids(p, a).pkg}
- Write app/src/main/java/${ids(p, a).pkg.replace(/\./g, '/')}/MainActivity.kt (class MainActivity : ComponentActivity) and any other .kt files in the same folder/package.
- Available libraries ONLY: Compose (ui, material3, material-icons-extended), activity-compose, lifecycle-viewmodel-compose, navigation-compose, okhttp 4.12, org.json (built-in), kotlinx-coroutines-android. No kotlinx.serialization, no Retrofit, no Supabase/Firebase SDKs.
- Config.kt already exists (do NOT write it): object Config { BACKEND, SUPABASE_URL, SUPABASE_ANON_KEY, FIREBASE_DB_URL, FIREBASE_API_KEY }.
- Supabase via REST (PostgREST): \${SUPABASE_URL}/rest/v1/<table> with headers apikey and Authorization: Bearer <anon key>. Firebase RTDB via REST: \${FIREBASE_DB_URL}/path.json. All network calls on Dispatchers.IO.
- Do NOT write gradle files, AndroidManifest.xml or resources. Use only android.R / default resources.`,
  python: () => `Stack: Python 3 + Kivy 2.3, packaged with Buildozer.
- Entry: main.py (class ...(App) with build()). You may add more .py/.kv files at the root.
- Available packages ONLY: kivy, requests (and the Python stdlib).
- config.py already exists (do NOT write it): BACKEND, SUPABASE_URL, SUPABASE_ANON_KEY, FIREBASE_DB_URL, FIREBASE_API_KEY.
- Supabase via REST (requests to SUPABASE_URL + "/rest/v1/<table>" with headers apikey and Authorization Bearer). Firebase RTDB via REST (.json URLs).
- Do network work in threading.Thread and update the UI with kivy.clock.Clock.schedule_once.
- Kivy cannot shape Arabic text by default: use English UI text unless the user explicitly needs Arabic.
- Do NOT write buildozer.spec.`,
};

const PREVIEW_RULE = `- ALSO write preview/index.html: one self-contained HTML file (inline CSS/JS, mobile viewport) that is a faithful web mock of this app — same screens, layout, colors, texts and navigation, with interactive behavior and realistic sample data — so the user can preview the app before building the APK. If a backend is configured, the mock may call it with fetch using the same public config values.`;

export function backendDescription(project) {
  const b = project.backend || {};
  if (b.type === 'supabase') {
    return `Backend: Supabase (shared by all apps of this project). The database schema below is ALREADY applied — use these exact tables/columns:\n${b.sql || '(no tables)'}\n${b.contract ? `Data contract:\n${b.contract}` : ''}`;
  }
  if (b.type === 'firebase') {
    return `Backend: Firebase Realtime Database (shared by all apps of this project). Data structure / contract:\n${b.contract || '(free-form)'}`;
  }
  return 'Backend: none. Store data locally on the device.';
}

export function planPrompt({ description, stack, mode, backendType }) {
  const system = `You are a senior mobile software architect. You design small, buildable Android apps. Reply ONLY with a JSON object inside a \`\`\`json fenced block.`;
  const prompt = `User request (may be Arabic):\n"""${description}"""\n
Target stack: ${stack}. Number of apps: ${mode === 'linked' ? 'TWO apps that are connected through a shared realtime backend (e.g. customer app + admin/driver app)' : 'ONE app'}.
Backend: ${backendType}.

Return JSON:
{
  "apps": [ { "id": "short lowercase latin id like user/admin", "name": "display name in the user's language", "role": "who uses it", "description": "detailed feature list and screens" } ],
  "sql": "${backendType === 'supabase' ? 'idempotent PostgreSQL for Supabase: create table if not exists ..., enable row level security, create policies (drop policy if exists first) allowing the anon role what the apps need, and add tables to the supabase_realtime publication inside DO blocks that ignore duplicate_object errors' : 'empty string'}",
  "firebaseRules": ${backendType === 'firebase' ? '{ "rules": { ... } } Realtime Database security rules for this structure' : 'null'},
  "contract": "precise description of every table/path, field names and types, and how the apps exchange data in realtime"
}
Exactly ${mode === 'linked' ? 2 : 1} app(s). Keep the scope realistic for a first version but complete and polished.`;
  return { system, prompt };
}

function systemFor(project, app) {
  const others = project.apps.filter((x) => x.id !== app.id);
  return `You are an expert Android app developer. You write complete, production-quality, compile-ready code with a polished modern UI (good spacing, colors, icons, empty/loading/error states). Support RTL when UI text is Arabic.
${STACK_RULES[project.stack](project, app)}
${project.stack === 'html' || project.stack === 'react' ? '' : PREVIEW_RULE}

Project: "${project.name}".
This app: "${app.name}" (id: ${app.id}) — role: ${app.role || '-'}.
${others.length ? `It is part of a connected system with: ${others.map((o) => `"${o.name}" (${o.role})`).join(', ')}. Data written by one app must appear in the other in realtime through the shared backend.` : ''}
${backendDescription(project)}

The config file ${configPath(project.stack, project, app)} looks like this (do not write it):
${configFile(project.stack, project, app, { type: project.backend?.type, supabaseUrl: 'https://<ref>.supabase.co', supabaseAnonKey: '<anon key>', firebaseDbUrl: 'https://<db>.firebaseio.com' })}

${FORMAT}`;
}

export function generatePrompt(project, app) {
  return {
    system: systemFor(project, app),
    prompt: `Build this app now.\nFeatures/screens:\n${app.description}\n\nOriginal user request:\n"""${project.description}"""`,
  };
}

export function editPrompt(project, app, instruction) {
  const current = Object.entries(app.files).map(([p, c]) => `=== FILE: ${p} ===\n${c}\n=== END FILE ===`).join('\n');
  return {
    system: systemFor(project, app) + `\n\nYou are EDITING an existing app. Output ONLY files that you create or change (complete contents). To delete a file output a line: === DELETE: path ===`,
    prompt: `Current files:\n${current}\n\nRequested change (may be Arabic):\n"""${instruction}"""`,
  };
}
