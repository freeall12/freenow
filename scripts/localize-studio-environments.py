"""Localize public environment resources from the captured catalog, without executing it."""
from pathlib import Path
import concurrent.futures, hashlib, json, re, urllib.request
root=Path(__file__).resolve().parent.parent
source=(root/'reference/vendor-pkg-canvas-world-DJzPiUMF.js').read_text()
block=source.split('rE=[',1)[1].split('],kN=',1)[0]
rows=re.findall(r'id:"([^"]+)".*?src:Pn\("([^"]+)"\).*?thumbnailSrc:Pn\("([^"]+)"\)',block)
labels=['柔光影棚','明亮室内','晴天户外','柔和街景','金色时刻','夜间街道']
assert len(rows)==6
base='https://files.tapnow.media/api/conversation/storage/uploads/'
catalog=[];jobs=[]
for (id,hdr,preview),label in zip(rows,labels):
 item={'id':id,'label':label,'url':f'assets/studio/environments/{id}.hdr','preview':f'assets/studio/environments/{id}.webp'}
 catalog.append(item)
 for kind,remote in [('url',hdr),('preview',preview)]:jobs.append((item[kind],base+remote))
def download(job):
 local,url=job;file=root/local;file.parent.mkdir(parents=True,exist_ok=True)
 if not file.exists():
  with urllib.request.urlopen(url,timeout=90) as r:data=r.read()
  if local.endswith('.hdr'):assert data.startswith((b'#?RADIANCE',b'#?RGBE'))
  else:assert data[:4]==b'RIFF' or data[0] in [137,255]
  file.write_bytes(data)
 data=file.read_bytes();return {'path':local,'source':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(download,jobs))
(root/'studio-environment-data.mjs').write_text('export const environmentPresets = '+json.dumps(catalog,ensure_ascii=False,indent=2)+';\n')
(root/'reference/stage-environment-assets.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'presets':len(catalog),'files':len(results),'bytes':sum(r['bytes'] for r in results)}))
