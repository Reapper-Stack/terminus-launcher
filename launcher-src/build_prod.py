"""Build the shipped launcher page (../launcher/index.html) from the design source in this folder.
Kept OUTSIDE launcher/ so the review mockup is never served by GitHub Pages.

  mockup.html  the reviewed design with its review bar (R1-R130; open it in a browser to review states)
  prod.js/css  the production layer: bridge v2, real data, no invented numbers
  ../launcher/data/*.json  news, patch notes, events (inlined by ../launcher/build_data.py)
Assets (img/, audio/) live in ../launcher/ and are shared. Usage: python build_prod.py [dest]"""
import os, shutil, sys, importlib.util

SRC = os.path.dirname(os.path.abspath(__file__))
DST = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(SRC), 'launcher')

html = open(os.path.join(SRC, 'mockup.html'), encoding='utf-8').read()
assert html.count('<head>') == 1 and html.count('</body>') <= 1
head = ('<head>\n<script>window.TD_PROD=1;document.documentElement.classList.add(\'prod\')</script>\n<link rel="stylesheet" href="prod.css">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com data:; media-src \'self\' data: blob:; img-src \'self\' data: blob:; connect-src \'self\'">')
html = html.replace('<head>', head, 1)
html = html.replace('<title>Terminus Launcher — ', '<title>Digimon Terminus<!-- ', 1).replace(' rounds</title>', ' --></title>', 1)
tail = '<script src="prod.js"></script>\n'
html = html.replace('</body>', tail + '</body>', 1) if '</body>' in html else html + tail

os.makedirs(DST, exist_ok=True)
open(os.path.join(DST, 'index.html'), 'w', encoding='utf-8', newline='').write(html)
for f in ('prod.js', 'prod.css'):
    shutil.copy2(os.path.join(SRC, f), os.path.join(DST, f))
for d in ('img', 'audio'):
    if os.path.isdir(os.path.join(SRC, d)) and os.path.abspath(DST) != os.path.join(os.path.dirname(SRC), 'launcher'):
        shutil.copytree(os.path.join(SRC, d), os.path.join(DST, d), dirs_exist_ok=True)

spec = importlib.util.spec_from_file_location('bd', os.path.join(os.path.dirname(SRC), 'launcher', 'build_data.py'))
bd = importlib.util.module_from_spec(spec); spec.loader.exec_module(bd)
# build_data reads the data next to itself (launcher/data); for another destination copy that data too
if os.path.abspath(DST) != os.path.join(os.path.dirname(SRC), 'launcher'):
    for d in ('img', 'audio', 'data'):
        shutil.copytree(os.path.join(os.path.dirname(SRC), 'launcher', d), os.path.join(DST, d), dirs_exist_ok=True)
print('built', DST, 'news/events inlined:', bd.inline(os.path.join(DST, 'index.html')))
