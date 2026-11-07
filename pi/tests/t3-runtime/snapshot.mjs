// Filesystem evidence for private launcher snapshots. Streaming avoids loading binaries.
import { readdir, realpath, lstat, readlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
const [mode,...roots]=process.argv.slice(2);
for(const argument of roots){
  const root=await realpath(argument);
  async function walk(path){
    const stat=await lstat(path);
    if(stat.isSymbolicLink()){
      const target=await realpath(path);
      if(mode==='audit'&&target!==root&&!target.startsWith(root+'/'))throw new Error(`Escaping symlink: ${path} -> ${target}`);
      if(mode==='hash')console.log(`link ${relative(root,path)} ${await readlink(path)}`);
    }else if(stat.isDirectory()){
      for(const name of (await readdir(path)).sort())if(name!=='.git')await walk(join(path,name));
    }else if(stat.isFile()&&mode==='hash'){
      const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
      console.log(`${hash.digest('hex')} ${relative(root,path)}`);
    }
  }
  await walk(root);
}
