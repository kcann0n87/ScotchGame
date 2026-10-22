#!/usr/bin/env python3
import os
d = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(d, 'style.css')) as f: css = f.read()
with open(os.path.join(d, 'scoring.js')) as f: scoring = f.read()
with open(os.path.join(d, 'supabase-lib.js')) as f: supabase_lib = f.read()
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,500;1,700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<div id="app"></div>
<script>
// Supabase JS v2 UMD (inlined — no CDN dependency)
{supabase_lib}
</script>
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
