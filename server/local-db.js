import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function openLocalDB(file){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  await fs.mkdir(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  const names=(await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort();
  for(const name of names){
    if(db.prepare('SELECT name FROM local_migrations WHERE name = ?').get(name))continue;
    db.exec('BEGIN');
    try{db.exec(await fs.readFile(path.join(root,'drizzle',name),'utf8'));db.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(name);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  }
  return {
    close:()=>db.close(),
    prepare(sql){
      return {
        bind(...args){
          return {
            async first(){return db.prepare(sql).get(...args)||null},
            async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
          };
        }
      };
    }
  };
}
