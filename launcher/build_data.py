"""Inline data/news.json and data/events.json into index.html (between the TDATA markers).

The live page fetches the JSON files beside it; the inline copy is what the launcher's offline
fallback (art/html/index.html, a file:// page that cannot fetch) and local previews show.
Run after editing either JSON file:  python dev/releases-repo/launcher/build_data.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def inline(page_path=os.path.join(HERE, 'index.html')):
    news = json.load(open(os.path.join(HERE, 'data', 'news.json'), encoding='utf-8'))
    events = json.load(open(os.path.join(HERE, 'data', 'events.json'), encoding='utf-8'))
    for e in events.get('events', []):
        for k in ('id', 'start', 'end'):
            if not e.get(k):
                sys.exit('events.json: an event has no ' + k)
    blob = json.dumps({'news': news, 'events': events}, ensure_ascii=False, separators=(',', ':'))
    blob = blob.replace('</', '<\\/')  # never close the script element early
    tag = '<!--TDATA--><script id="tdata" type="application/json">' + blob + '</script><!--/TDATA-->'
    html = open(page_path, encoding='utf-8').read()
    if '<!--TDATA-->' in html:
        html = re.sub(r'<!--TDATA-->.*?<!--/TDATA-->', lambda m: tag, html, count=1, flags=re.S)
    else:
        anchor = '<script src="prod.js"></script>'
        i = html.index(anchor) if anchor in html else (html.rindex('</body>') if '</body>' in html else len(html))
        html = html[:i] + tag + '\n' + html[i:]
    open(page_path, 'w', encoding='utf-8', newline='').write(html)
    return len(news.get('items', [])), len(events.get('events', []))


if __name__ == '__main__':
    n, e = inline()
    print('inlined %d news items and %d events into index.html' % (n, e))
