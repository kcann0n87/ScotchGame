#!/usr/bin/env python3
import os
d = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(d, 'style.css')) as f: css = f.read()
with open(os.path.join(d, 'scoring.js')) as f: scoring = f.read()
with open(os.path.join(d, 'supabase.js')) as f: supabase_js = f.read()
with open(os.path.join(d, 'app.js')) as f: app = f.read()

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#0a5d2e" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<title>Scotch Golf</title>
<!-- Supabase JS client (loaded from CDN; only used if credentials are set) -->
<script src="https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<style>
{css}
</style>
</head>
<body>
<div id="app"></div>
<script>
{scoring}
</script>
<script>
{supabase_js}
</script>
<script>
{app}
</script>
</body>
</html>
"""
with open(os.path.join(d, 'index.html'), 'w') as f:
    f.write(html)
print(f"Built index.html: {len(html)} bytes")
