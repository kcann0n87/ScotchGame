#!/usr/bin/env python3
import os
d = os.path.dirname(os.path.abspath(__file__))
parent = os.path.dirname(d)
with open(os.path.join(d, 'admin.css')) as f: css = f.read()
with open(os.path.join(parent, 'scotch-app', 'supabase-lib.js')) as f: supabase_lib = f.read()
with open(os.path.join(d, 'admin.js')) as f: admin_js = f.read()

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Scotch Admin</title>
<style>
{css}
</style>
</head>
<body>
<div id="admin-root"></div>
<script>
{supabase_lib}
</script>
<script>
{admin_js}
</script>
</body>
</html>
"""
with open(os.path.join(d, 'index.html'), 'w') as f:
    f.write(html)
print(f"Built admin/index.html: {len(html)} bytes")
