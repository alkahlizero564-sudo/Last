// GitHub: إنشاء المستودع، دفع الملفات بكومِت واحد، تشغيل البناء، ومتابعة النتائج.
const API = 'https://api.github.com';

export class GitHub {
  constructor(token, fetchImpl = fetch) {
    if (!token) throw new Error('مفتاح GitHub غير مضبوط في الإعدادات');
    this.token = token;
    this.fetch = fetchImpl;
  }

  async req(method, path, body, { raw = false, accept } = {}) {
    const res = await this.fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: accept || 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'apk-forge',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    if (res.status === 204) return null;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`GitHub ${res.status}: ${data?.message || text}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async me() {
    if (!this._me) this._me = await this.req('GET', '/user');
    return this._me;
  }

  async ensureRepo(name, isPrivate = true) {
    const { login } = await this.me();
    try {
      return await this.req('GET', `/repos/${login}/${name}`);
    } catch (e) {
      if (e.status !== 404) throw e;
      return this.req('POST', '/user/repos', {
        name, private: isPrivate, auto_init: true,
        description: 'Android apps generated and built by APK Forge',
      });
    }
  }

  // يدفع مجموعة ملفات (path -> content) ويحذف المسارات المحددة، في كومِت واحد على الفرع الافتراضي
  async commitFiles(repo, files, message, deletePaths = []) {
    const full = repo.full_name;
    const branch = repo.default_branch || 'main';
    const ref = await this.req('GET', `/repos/${full}/git/ref/heads/${branch}`);
    const parent = await this.req('GET', `/repos/${full}/git/commits/${ref.object.sha}`);

    const tree = [];
    const entries = Object.entries(files);
    // إنشاء الـ blobs على دفعات متوازية صغيرة
    for (let i = 0; i < entries.length; i += 8) {
      const chunk = entries.slice(i, i + 8);
      const blobs = await Promise.all(chunk.map(([, content]) =>
        this.req('POST', `/repos/${full}/git/blobs`, { content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' })));
      chunk.forEach(([path], j) => tree.push({ path, mode: '100644', type: 'blob', sha: blobs[j].sha }));
    }
    for (const path of deletePaths) if (!(path in files)) tree.push({ path, mode: '100644', type: 'blob', sha: null });

    const newTree = await this.req('POST', `/repos/${full}/git/trees`, { base_tree: parent.tree.sha, tree });
    const commit = await this.req('POST', `/repos/${full}/git/commits`, { message, tree: newTree.sha, parents: [parent.sha] });
    await this.req('PATCH', `/repos/${full}/git/refs/heads/${branch}`, { sha: commit.sha });
    return commit;
  }

  // تشغيل سير العمل يدوياً (مع إعادة المحاولة لأن GitHub قد يتأخر في تسجيل ملف سير عمل جديد)
  async dispatch(repo, workflowFile, attempts = 6, delayMs = 4000) {
    for (let i = 0; i < attempts; i++) {
      try {
        await this.req('POST', `/repos/${repo.full_name}/actions/workflows/${workflowFile}/dispatches`, { ref: repo.default_branch || 'main' });
        return true;
      } catch (e) {
        if (e.status !== 404 && e.status !== 422) throw e;
        if (i === attempts - 1) throw e;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return false;
  }

  async runs(repoFull, workflowFile, perPage = 5) {
    try {
      const d = await this.req('GET', `/repos/${repoFull}/actions/workflows/${workflowFile}/runs?per_page=${perPage}`);
      return d.workflow_runs || [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async releaseByTag(repoFull, tag) {
    try { return await this.req('GET', `/repos/${repoFull}/releases/tags/${encodeURIComponent(tag)}`); } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // تنزيل ملف APK من الإصدار (يعمل مع المستودعات الخاصة)
  async downloadAsset(repoFull, assetId) {
    const res = await this.req('GET', `/repos/${repoFull}/releases/assets/${assetId}`, null, { raw: true, accept: 'application/octet-stream' });
    if (!res.ok) throw new Error(`GitHub ${res.status} أثناء تنزيل الملف`);
    return res;
  }
}
