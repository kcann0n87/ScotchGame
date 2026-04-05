#!/usr/bin/env python3
import http.server
import socketserver
import os
import socket
import time

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))
PORT = 5000
HOST = "0.0.0.0"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True
    allow_reuse_port = True

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except (AttributeError, OSError):
            pass
        super().server_bind()

for attempt in range(10):
    try:
        httpd = ReusableTCPServer((HOST, PORT), Handler)
        print(f"Serving {DIR} on {HOST}:{PORT}")
        httpd.serve_forever()
        break
    except OSError as e:
        if attempt < 9:
            print(f"Port {PORT} busy, retrying in 2s... ({e})")
            time.sleep(2)
        else:
            raise
