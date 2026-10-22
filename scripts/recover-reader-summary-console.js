/*
 * Paste this entire file into DevTools Console while the reader is open.
 * It only READS browser storage. Results are saved to
 * window.__readerSummaryRecovery and copied to the clipboard when possible.
 */
(async () => {
  const getAll = async (dbName, storeName) => {
    try {
      if (typeof indexedDB.databases !== 'function') {
        console.warn(`Skipping ${dbName}/${storeName}: this browser cannot prove the database already exists.`);
        return [];
      }
      const known = await indexedDB.databases();
      if (!known.some((db) => db.name === dbName)) return [];
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        return [];
      }
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return rows;
    } catch (error) {
      console.warn(`Could not read ${dbName}/${storeName}:`, error);
      return [];
    }
  };

  const summaries = [];
  const prefix = 'reader-summary:';
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const lastColon = rest.lastIndexOf(':');
    summaries.push({
      source: 'localStorage',
      key,
      docId: lastColon >= 0 ? rest.slice(0, lastColon) : rest,
      chapter: lastColon >= 0 ? Number(rest.slice(lastColon + 1)) : null,
      text: localStorage.getItem(key) ?? '',
    });
  }

  const [articles, durableCurrent, durableHistory] = await Promise.all([
    getAll('reader-articles', 'articles'),
    getAll('reader-summaries', 'current'),
    getAll('reader-summaries', 'history'),
  ]);

  for (const row of durableCurrent) summaries.push({ source: 'indexedDB-current', ...row });
  for (const row of durableHistory) summaries.push({ source: 'indexedDB-history', ...row });

  const articleTitles = new Map(articles.map((article) => [article.id, article.title]));
  const enriched = summaries
    .map((summary) => ({ ...summary, title: articleTitles.get(summary.docId) ?? null }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const understanding = enriched.filter((summary) =>
    /understanding/i.test(`${summary.key ?? ''} ${summary.docId ?? ''} ${summary.title ?? ''}`),
  );
  const matchingArticles = articles
    .filter((article) => /understanding/i.test(`${article.id} ${article.title}`))
    .map(({ id, title, type, savedAt }) => ({ id, title, type, savedAt }));

  const result = {
    origin: location.origin,
    recoveredAt: new Date().toISOString(),
    matchingArticles,
    understanding,
    allSummaries: enriched,
  };

  window.__readerSummaryRecovery = result;
  console.log('Reader summary recovery (non-destructive):', result);
  console.table(understanding.map((item, index) => ({
    index,
    source: item.source,
    docId: item.docId,
    chapter: item.chapter,
    chars: item.text?.length ?? 0,
    updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : 'legacy/unknown',
  })));
  understanding.forEach((item, index) => {
    console.log(`UNDERSTANDING COPY ${index} [${item.source}]\n${item.text}\n`);
  });

  const exported = JSON.stringify(result, null, 2);
  try {
    if (typeof copy === 'function') copy(exported); // Chrome DevTools helper
    else await navigator.clipboard.writeText(exported);
    console.log('Copied the complete recovery bundle to your clipboard.');
  } catch {
    console.log('Clipboard was blocked. Run: copy(JSON.stringify(window.__readerSummaryRecovery, null, 2))');
  }
  return result;
})();
