// Run inside the web container. Exports never include account credentials.
// list | export <dataset-id> <archive.gz> | import <archive.gz> <local-owner> --local
const { Pool } = require('pg');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const sha = data => createHash('sha256').update(data).digest('hex');
const tables = ['handwriting_datasets', 'handwriting_assets', 'handwriting_jobs', 'handwriting_publications', 'handwriting_experiments'];

async function main() {
  const [action, target, destination, confirmation] = process.argv.slice(2);
  const pool = new Pool({ ...(process.env.HANDWRITING_DATABASE_URL ? { connectionString: process.env.HANDWRITING_DATABASE_URL } : {}), max: 1 });
  const client = await pool.connect();
  try {
    if (action === 'list') {
      const { rows } = await client.query(`SELECT d.id,d.name,d.created_at,d.version,d.summary,d.source->'configuration' AS configuration,
        d.source->'renderScale' AS render_scale,jsonb_array_length(d.candidates->'samples') AS samples
        FROM handwriting_datasets d ORDER BY d.created_at DESC`);
      console.log(JSON.stringify(rows));
    } else if (action === 'export') {
      if (!/^[a-f0-9]{64}$/.test(target) || !destination) throw Error('Expected dataset ID and new output path');
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = { format: 'aibook-handwriting-snapshot-v1', exportedAt: new Date().toISOString(), tables: {} };
      for (const table of tables) {
        if (table === 'handwriting_experiments' && !(await client.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) {
          snapshot.tables[table] = []; continue;
        }
        const column = table === 'handwriting_datasets' ? 'id' : 'dataset_id';
        snapshot.tables[table] = (await client.query(`SELECT * FROM ${table} WHERE ${column}=$1`, [target])).rows.map(row =>
          table === 'handwriting_assets' ? { ...row, data: row.data.toString('base64') } : row);
      }
      if (snapshot.tables.handwriting_datasets.length !== 1) throw Error('Dataset not found');
      await client.query('COMMIT');
      const archive = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)));
      fs.writeFileSync(destination, archive, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ path: destination, bytes: archive.length, sha256: sha(archive), counts: Object.fromEntries(tables.map(t => [t, snapshot.tables[t].length])) }));
    } else if (action === 'import') {
      if (confirmation !== '--local' || !destination) throw Error('Import requires a local owner and --local');
      const archive = fs.readFileSync(target), snapshot = JSON.parse(zlib.gunzipSync(archive));
      if (snapshot.format !== 'aibook-handwriting-snapshot-v1' || snapshot.tables?.handwriting_datasets?.length !== 1) throw Error('Invalid snapshot');
      const id = snapshot.tables.handwriting_datasets[0].id;
      for (const asset of snapshot.tables.handwriting_assets) {
        if (asset.dataset_id !== id || sha(Buffer.from(asset.data, 'base64')) !== asset.sha256) throw Error('Asset integrity failure');
      }
      await client.query('BEGIN');
      const owner = (await client.query('SELECT id FROM users WHERE username=$1', [destination])).rows[0];
      if (!owner) throw Error('Local owner not found');
      if ((await client.query('SELECT 1 FROM handwriting_datasets WHERE id=$1', [id])).rowCount) throw Error('Snapshot already exists; refusing to overwrite');
      for (const table of tables) for (const original of snapshot.tables[table]) {
        const row = { ...original };
        if ((table === 'handwriting_datasets' ? row.id : row.dataset_id) !== id) throw Error('Unrelated row in snapshot');
        if (table === 'handwriting_datasets') row.owner_id = owner.id;
        if (table === 'handwriting_publications') row.published_by = owner.id;
        if (table === 'handwriting_assets') row.data = Buffer.from(row.data, 'base64');
        // A restored snapshot must not start production's unfinished jobs locally.
        if (table === 'handwriting_jobs' && ['queued', 'running'].includes(row.status)) { row.status = 'failed'; row.error = 'Unfinished job restored from snapshot'; }
        const keys = Object.keys(row);
        if (!keys.every(k => /^[a-z_][a-z0-9_]*$/.test(k))) throw Error('Invalid column');
        await client.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`, keys.map(k => row[k]));
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({ imported: id, sha256: sha(archive), assetsVerified: snapshot.tables.handwriting_assets.length }));
    } else throw Error('Use list, export <id> <path>, or import <path> <local-owner> --local');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
