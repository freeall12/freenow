"""Cache the exact font filenames published in the source editor catalog."""
import concurrent.futures
import json
from pathlib import Path
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parent.parent
catalog_path = root / 'image-editor-fonts.js'
data = json.loads(catalog_path.read_text().split('=', 1)[1].strip().rstrip(';'))
folder = root / 'assets/fonts'
folder.mkdir(exist_ok=True)

def cache(filename):
    target = folder / filename
    if target.exists() and target.stat().st_size > 100:
        return {'file': filename, 'bytes': target.stat().st_size, 'cached': True}
    try:
        with urllib.request.urlopen(data['base'] + urllib.parse.quote(filename), timeout=30) as response:
            content = response.read(12 * 1024 * 1024)
        if content[:4] not in (b'wOF2', b'wOFF', b'OTTO', b'\x00\x01\x00\x00', b'ttcf', b'true'):
            raise ValueError('Unexpected font signature')
        target.write_bytes(content)
        return {'file': filename, 'bytes': len(content), 'cached': False}
    except Exception as error:
        return {'file': filename, 'error': str(error)}

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    results = list(executor.map(cache, sorted(set(data['catalog'].values()))))
files = {r['file'] for r in results if 'error' not in r}
data['local'] = [name for name, filename in data['catalog'].items() if filename in files]
catalog_path.write_text('window.IMAGE_EDITOR_FONTS=' + json.dumps(data, ensure_ascii=False) + ';\n')
(root / 'reference/image-editor-font-downloads.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({'fontNames': len(data['catalog']), 'localNames': len(data['local']), 'uniqueFiles': len(files), 'bytes': sum(r.get('bytes', 0) for r in results), 'errors': [r for r in results if 'error' in r]}, ensure_ascii=False))
