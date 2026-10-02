"""Extract the public static model catalog without executing vendor JavaScript."""
from pathlib import Path
import json,re,urllib.request,concurrent.futures,hashlib,time
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'reference/vendor-pkg-canvas-world-DJzPiUMF.js').read_text();a=s.index('cM=[')+3;depth=0;quoted=False
for i in range(a,len(s)):
 ch=s[i]
 if ch=='"' and s[i-1]!='\\':quoted=not quoted
 if not quoted:
  if ch=='[':depth+=1
  elif ch==']':
   depth-=1
   if depth==0:break
raw=re.sub(r'([{,])([A-Za-z][A-Za-z0-9]*):',r'\1"\2":',s[a:i+1]);raw=re.sub(r':(-?)\.(\d)',r':\g<1>0.\2',raw);groups=json.loads(raw)
labels=['树','岩石','交通工具','猫&狗','其他动物','宠物用品','植被','室内','户外'];assets=ROOT/'assets/studio/library';assets.mkdir(parents=True,exist_ok=True)
base='https://files.tapnow.media/api/conversation/storage/uploads/'
for group,label in zip(groups,labels):
 group['label']=label
 for item in group['assets']:
  item['sourceModel']=base+item['model'];item['sourcePreview']=base+item['preview'];item['model']='assets/studio/library/'+item['id']+'.glb';item['preview']='assets/studio/library/'+item['id']+'.webp'

def download(task):
 url,relative=task;path=ROOT/relative
 for attempt in range(3):
  try:
   if not path.exists():
    request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(request,timeout=60) as response:content=response.read()
    if relative.endswith('.glb') and content[:4]!=b'glTF':raise ValueError('Not a GLB')
    if not relative.endswith('.glb') and content[:1]==b'<':raise ValueError('Not an image')
    path.write_bytes(content)
   content=path.read_bytes()
   return {'path':relative,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
  except Exception as e:
   if attempt==2:return {'path':relative,'error':str(e)}
   time.sleep(attempt+1)
tasks=[(item[source],item[target]) for g in groups for item in g['assets'] for source,target in [('sourceModel','model'),('sourcePreview','preview')]]
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for result in pool.map(download,tasks):
  results.append(result)
  if 'error' in result:print('ERROR',result,flush=True)
  elif len(results)%12==0:print(f'{len(results)}/{len(tasks)} assets checked',flush=True)
(ROOT/'reference/stage-library-catalog.json').write_text(json.dumps(groups,ensure_ascii=False,indent=2))
(ROOT/'reference/stage-library-assets.json').write_text(json.dumps(results,indent=2))
public=[{'id':g['id'],'label':g['label'],'assets':[{k:v for k,v in item.items() if not k.startswith('source')} for item in g['assets']]} for g in groups]
(ROOT/'studio-library-data.mjs').write_text('// Public original sample catalog; scale and asset order preserved.\nexport const studioLibrary='+json.dumps(public,ensure_ascii=False)+';\n')
print(json.dumps({'groups':len(groups),'models':sum(len(g['assets']) for g in groups),'assets':len(results),'bytes':sum(r.get('bytes',0) for r in results),'errors':sum('error' in r for r in results)},ensure_ascii=False),flush=True)
