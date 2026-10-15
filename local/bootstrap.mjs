import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
const credentials=JSON.parse(await readFile('/run/secrets/credentials','utf8'));
if(process.env.NODE_ENV!=='development')throw new Error('Local bootstrap requires development mode.');
const db=new pg.Client({host:'db',port:5432,database:'operator_local',user:'postgres',password:credentials.databasePassword});
await db.connect();
try {
 await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
 await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(filename text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 const files=(await readdir('/business-migrations')).filter(x=>/^\d{4}_.*\.sql$/.test(x)).sort();
 for(const file of files){if((await db.query('SELECT 1 FROM schema_migrations WHERE filename=$1',[file])).rowCount)continue;
  await db.query('BEGIN');try{await db.query(await readFile(`/business-migrations/${file}`,'utf8'));await db.query('INSERT INTO schema_migrations(filename) VALUES($1)',[file]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw new Error(`Local migration failed: ${file}`,{cause:e});}
 }
 // ALTER ROLE does not accept parameters; quote the generated value as a SQL literal.
 await db.query(`ALTER ROLE drezivo_app WITH LOGIN PASSWORD '${credentials.runtimePassword.replaceAll("'","''")}'`);
 await db.query(await readFile('local/seed.sql','utf8'));
 console.log(`Applied ${files.length} business migrations; synthetic local data ready.`);
} finally {await db.end();}
