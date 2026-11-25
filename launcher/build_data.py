"""Inline data/news.json and data/events.json into index.html (between the TDATA markers).

The live page fetches the JSON files beside it; the inline copy is what the launcher's offline
fallback (art/html/index.html, a file:// page that cannot fetch) and local previews show.
Run after editing either JSON file (from the channel repo root):  python launcher/build_data.py
(launcher_publish.py runs it for you).  python launcher/build_data.py --check  validates the data without touching the page.
"""
import datetime, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$')   # an explicit offset: an offset-less time would be read as the player's local time
DAY = re.compile(r'^\d{4}-\d\d-\d\d$')
THUMB = re.compile(r'^img/[a-z0-9/_-]+\.(png|jpg|webp)$', re.I)                         # the same pattern prod.js applies
TAGS = ('client', 'server', 'event')


def _when(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))


def _bi(o, where, errs, req=True):
    """{en, pt}: both non-empty strings (a missing language shows a blank line for half the players)."""
    if o is None and not req:
        return
    if not isinstance(o, dict):
        errs.append(where + ': must be {"en":..., "pt":...}')
        return
    for lg in ('en', 'pt'):
        if not isinstance(o.get(lg), str) or not o[lg].strip():
            errs.append(where + '.' + lg + ': missing or empty')


def validate(news, events, root=HERE):
    """A-90: every mistake a hand edit of news.json / events.json can make that the page would show wrongly (or swallow silently). Returns a list of messages."""
    errs = []
    if not isinstance(events, dict) or not isinstance(events.get('events'), list):
        return ['events.json: "events" must be a list']
    if not isinstance(news, dict) or not isinstance(news.get('items'), list):
        return ['news.json: "items" must be a list']
    eids = set()
    for n, e in enumerate(events['events']):
        w = 'events[%d]' % n
        if not isinstance(e, dict):
            errs.append(w + ': not an object'); continue
        i = e.get('id')
        if not isinstance(i, str) or not i:
            errs.append(w + ': no id'); continue
        w = 'event ' + i
        if i in eids:
            errs.append(w + ': duplicate id')
        eids.add(i)
        ok = True
        for k in ('start', 'end'):
            v = e.get(k)
            if not isinstance(v, str) or not ISO.match(v):
                errs.append('%s.%s: need ISO 8601 with an offset (2026-11-13T18:00:00+00:00), got %r' % (w, k, v)); ok = False
            else:
                try: _when(v)
                except ValueError: errs.append('%s.%s: not a real date/time: %r' % (w, k, v)); ok = False
        if ok and _when(e['end']) <= _when(e['start']):
            errs.append(w + ': end must be after start (the page drops such an event silently)')
        _bi(e.get('title'), w + '.title', errs)
        _bi(e.get('short'), w + '.short', errs, req=False)
        _bi(e.get('body'), w + '.body', errs, req=False)
    nids = set()
    for n, it in enumerate(news['items']):
        w = 'news.items[%d]' % n
        if not isinstance(it, dict):
            errs.append(w + ': not an object'); continue
        i = it.get('id')
        if not isinstance(i, str) or not i:
            errs.append(w + ': no id'); continue
        w = 'news ' + i
        if i in nids:
            errs.append(w + ': duplicate id')
        nids.add(i)
        d = it.get('date')
        if not isinstance(d, str) or not DAY.match(d):
            errs.append(w + '.date: need YYYY-MM-DD, got %r' % (d,))
        else:
            try: datetime.date.fromisoformat(d)
            except ValueError: errs.append(w + '.date: not a real date: ' + d)
        if it.get('tag') not in TAGS:
            errs.append(w + '.tag: must be one of ' + '|'.join(TAGS) + ', got %r' % (it.get('tag'),))
        _bi(it.get('title'), w + '.title', errs)
        _bi(it.get('body'), w + '.body', errs)
        t = it.get('thumb')
        if t is not None:
            if not isinstance(t, str) or not THUMB.match(t):
                errs.append(w + '.thumb: %r does not match img/<path>.png|jpg|webp (the page would show the generic picture)' % (t,))
            elif os.path.isdir(os.path.join(root, 'img', 'thumbs')) and not os.path.isfile(os.path.join(root, t)):
                # only checked next to the real img/ (launcher_publish stages the data without it)
                errs.append(w + '.thumb: file %s does not exist' % t)
        lede = it.get('lede')
        if lede is not None:
            for lg in ('en', 'pt'):
                v = lede.get(lg) if isinstance(lede, dict) else None
                if not isinstance(v, str) or not v.strip():
                    errs.append(w + '.lede.' + lg + ': missing')
                elif len(v) > 105:
                    errs.append(w + '.lede.' + lg + ': %d characters; the hero shows two lines, keep it to about 100' % len(v))
        ev = it.get('event')
        if ev is not None and ev not in eids:
            errs.append(w + '.event: %r is not an id in events.json' % (ev,))
    for n, no in enumerate(news.get('notes') or []):
        if not isinstance(no, dict) or not isinstance(no.get('id'), str) or not no['id']:
            errs.append('news.notes[%d]: no id' % n)
    return errs


def inline(page_path=os.path.join(HERE, 'index.html')):
    news = json.load(open(os.path.join(HERE, 'data', 'news.json'), encoding='utf-8'))
    events = json.load(open(os.path.join(HERE, 'data', 'events.json'), encoding='utf-8'))
    errs = validate(news, events)
    if errs:
        sys.exit('data/*.json invalid, nothing written:\n  ' + '\n  '.join(errs))
    blob = json.dumps({'news': news, 'events': events}, ensure_ascii=False, separators=(',', ':'))
    blob = blob.replace('</', '<\\/')            # never close the script element early
    blob = blob.replace('<!--', '<\\u0021--')    # A-89: nor open an HTML comment (a "<!--" then "<script" would put the page's own script into the data block)
    tag = '<!--TDATA--><script id="tdata" type="application/json">' + blob + '</script><!--/TDATA-->'
    html = open(page_path, encoding='utf-8').read()
    anchor = re.compile(r'<script src="prod\.js(\?[^"]*)?"></script>')
    if '<!--TDATA-->' in html:
        html = re.sub(r'<!--TDATA-->.*?<!--/TDATA-->', lambda m: tag, html, count=1, flags=re.S)
    else:
        m = anchor.search(html)
        i = m.start() if m else (html.rindex('</body>') if '</body>' in html else len(html))
        html = html[:i] + tag + '\n' + html[i:]
    # the page's own script must still follow the data block, exactly once
    if len(anchor.findall(html)) != 1 or anchor.search(html).start() < html.index('<!--/TDATA-->'):
        sys.exit('page check failed: expected exactly one <script src="prod.js"> after the data block')
    open(page_path, 'w', encoding='utf-8', newline='').write(html)
    return len(news.get('items', [])), len(events.get('events', []))


if __name__ == '__main__':
    if '--check' in sys.argv:
        errs = validate(json.load(open(os.path.join(HERE, 'data', 'news.json'), encoding='utf-8')), json.load(open(os.path.join(HERE, 'data', 'events.json'), encoding='utf-8')))
        print('\n'.join(errs) if errs else 'data ok')
        sys.exit(1 if errs else 0)
    n, e = inline()
    print('inlined %d news items and %d events into index.html' % (n, e))
