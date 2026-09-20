import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {access, mkdir, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

const model='Xenova/ast-finetuned-audioset-10-10-0.4593';
const revision='249a1fbf0286b40e7f1ed687a8ae396997bf7dc6';
const files={
  'config.json':'49d0dce922da23685787c73a874d9b1ffa97297f8cc4dc0a4e8bef219725e44d',
  'preprocessor_config.json':'8d04ba5a9c6fca5d39d0de2b1fd05ecf79deb589fbba279728bbebac39934231',
  'onnx/model_quantized.onnx':'807d244b58a30eaa89f0a721fb841619c696857aabe4eac93769bd0b61497f61',
};
const baseFlag=process.argv.indexOf('--base');
const base=new URL(baseFlag===-1?'https://huggingface.co':process.argv[baseFlag+1]);
if(base.protocol!=='https:' || base.username || base.password)throw Error('--base must be an HTTPS host without credentials');
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
for(const [name,expected] of Object.entries(files)){
  const target=fileURLToPath(new URL(`../public/models/${model}/${name}`,import.meta.url));
  let exists=false;try{await access(target);exists=true;}catch{}
  if(exists){
    if(await digest(target)!==expected)throw Error(`${name}: existing file differs from the pinned model. Back it up and resolve manually; it was not overwritten.`);
    console.log(`Verified ${name}`);continue;
  }
  await mkdir(dirname(target),{recursive:true});
  const temporary=`${target}.download-${randomUUID()}`;
  console.log(`Downloading ${name} from ${base.origin} ...`);
  try{
    const response=await fetch(`${base.origin}/${model}/resolve/${revision}/${name}`,{signal:AbortSignal.timeout(600000)});
    if(!response.ok||!response.body)throw Error(`Download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{flags:'wx'}));
    if(await digest(temporary)!==expected)throw Error(`Checksum mismatch: ${name}`);
    await rename(temporary,target);
    console.log(`Installed ${name}`);
  }finally{await rm(temporary,{force:true});}
}
console.log('Local AST model is ready. Run npm run platform.');
