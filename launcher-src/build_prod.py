"""Build the shipped launcher page (../launcher/index.html) from the design source in this folder.
Kept OUTSIDE launcher/ so the review mockup is never served by GitHub Pages.

  mockup.html  the reviewed design with its review bar (R1-R130; open it in a browser to review states)
  prod.js/css  the production layer: bridge v2, real data, no invented numbers
  ../launcher/data/*.json  news, patch notes, events (inlined by ../launcher/build_data.py)
Assets (img/, audio/) live in ../launcher/ and are shared. Usage: python build_prod.py [dest]"""
import os, shutil, sys, importlib.util, hashlib, glob
sys.dont_write_bytecode = True      # never leave launcher/__pycache__ (it would be committed and published)
PRUNE = '--prune-legacy' in sys.argv; sys.argv = [x for x in sys.argv if x != '--prune-legacy']

SRC = os.path.dirname(os.path.abspath(__file__))
DST = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(SRC), 'launcher')

def h8(f):
    # A-86: content hash of a page asset, so index.html always asks for the exact prod.js / prod.css it was built with
    return hashlib.sha256(open(os.path.join(SRC, f), 'rb').read()).hexdigest()[:8]

html = open(os.path.join(SRC, 'mockup.html'), encoding='utf-8').read()
assert html.count('<head>') == 1 and html.count('</body>') <= 1
head = ('<head>\n<script>window.TD_PROD=1;document.documentElement.classList.add(\'prod\')</script>\n<link rel="stylesheet" href="prod.css?v=' + h8('prod.css') + '">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; font-src \'self\' data:; media-src \'self\' data: blob:; img-src \'self\' data: blob:; connect-src \'self\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'">')
html = html.replace('<head>', head, 1)
# the review mockup draws its scene from img/hero_2560.png (moved to img-dev); the shipped page never shows it (prod.css hides .scene) but the inline rule still made the browser ask for it
html = html.replace('url(img/hero_2560.png)', 'none')
html = html.replace('<title>Terminus Launcher — ', '<title>Digimon Terminus<!-- ', 1).replace(' rounds</title>', ' --></title>', 1)
tail = '<script src="prod.js?v=' + h8('prod.js') + '"></script>\n'
html = html.replace('</body>', tail + '</body>', 1) if '</body>' in html else html + tail

os.makedirs(DST, exist_ok=True)
open(os.path.join(DST, 'index.html'), 'w', encoding='utf-8', newline='').write(html)
for f in ('prod.js', 'prod.css'):
    shutil.copy2(os.path.join(SRC, f), os.path.join(DST, f))
for d in ('img', 'audio'):
    if os.path.isdir(os.path.join(SRC, d)) and os.path.abspath(DST) != os.path.join(os.path.dirname(SRC), 'launcher'):
        shutil.copytree(os.path.join(SRC, d), os.path.join(DST, d), dirs_exist_ok=True)

# A-21: art that no shipped state draws (hero scene and plates of the early rounds, the first server portrait). They move to launcher-src/img-dev
# (kept for the dev rounds gallery, never published) so the manifest and Pages stop carrying ~7.7 MB of dead pixels. Idempotent.
DEAD = ('hero_2560.png', 'hero_cannon_2560.png', 'hero_cannon_plate.png', 'hero_close_alpha.png', 'hero_cannon_alpha.png', 'hero_alpha.png', 'server_omegamon_r174.png')
# An older index.html cached by a player's WebView2 (Pages max-age is 10 min) still asks for these, so they stay for one release;
# `python build_prod.py --prune-legacy` moves them out (next release).
LEGACY = ('server_omegamon.png',) + tuple('thumbs/c%d.png' % i for i in range(1, 6))
if PRUNE: DEAD = DEAD + LEGACY
if os.path.abspath(DST) == os.path.join(os.path.dirname(SRC), 'launcher'):
    for f in DEAD:
        a = os.path.join(DST, 'img', f)
        if os.path.exists(a):
            os.makedirs(os.path.dirname(os.path.join(SRC, 'img-dev', f)), exist_ok=True)
            shutil.move(a, os.path.join(SRC, 'img-dev', f))
    # the cinematic's effect frames ship as f<n>.webp (meta.json "fx"); the original JPEGs stay here
    for a in (glob.glob(os.path.join(DST, 'img', 'cine', 'f*.jpg')) if PRUNE else []):
        os.makedirs(os.path.join(SRC, 'img-dev', 'cine'), exist_ok=True)
        shutil.move(a, os.path.join(SRC, 'img-dev', 'cine', os.path.basename(a)))

spec = importlib.util.spec_from_file_location('bd', os.path.join(os.path.dirname(SRC), 'launcher', 'build_data.py'))
bd = importlib.util.module_from_spec(spec); spec.loader.exec_module(bd)
# build_data reads the data next to itself (launcher/data); for another destination copy that data too
if os.path.abspath(DST) != os.path.join(os.path.dirname(SRC), 'launcher'):
    for d in ('img', 'audio', 'data'):
        shutil.copytree(os.path.join(os.path.dirname(SRC), 'launcher', d), os.path.join(DST, d), dirs_exist_ok=True)
print('built', DST, 'news/events inlined:', bd.inline(os.path.join(DST, 'index.html')))
